'use strict';

/* ================= хранилище ================= */

const LS_KEY = 'trenirovki.v1';
let db = loadDB();

function loadDB() {
  try {
    const d = JSON.parse(localStorage.getItem(LS_KEY));
    if (d && Array.isArray(d.exercises) && Array.isArray(d.entries)) return d;
  } catch (e) { /* пусто или битые данные */ }
  return { version: 1, exercises: [], entries: [] };
}
function saveDB(fromSync) {
  if (!fromSync) db.updatedAt = Date.now();
  if (!fromSync && typeof Sync !== 'undefined') Sync.schedule();
  try { localStorage.setItem(LS_KEY, JSON.stringify(db)); }
  catch (e) { alert('Не удалось сохранить данные: ' + e.message); }
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const getEx = (id) => db.exercises.find((x) => x.id === id);
const getEntry = (id) => db.entries.find((x) => x.id === id);
const entriesOf = (exId) => db.entries.filter((e) => e.exerciseId === exId);

/* ================= что записываем ================= */

// каждое упражнение хранит набор полей ex.fields; подход = объект с выбранными полями
const FIELDS = {
  weight: { label: 'Вес', inputs: [['weight', 'кг', 'decimal']] },
  reps: { label: 'Повторения', inputs: [['reps', 'повт', 'numeric']] },
  time: { label: 'Время', inputs: [['min', 'мин', 'numeric'], ['s', 'сек', 'numeric']] },
  distance: { label: 'Дистанция', inputs: [['km', 'км', 'decimal']] },
};
const FIELD_KEYS = Object.keys(FIELDS);
const LEGACY = { weight: ['weight', 'reps'], reps: ['reps'], time: ['time'], distance: ['distance', 'time'], count: ['reps'] };
const fieldsOf = (ex) => FIELD_KEYS.filter((k) => ex.fields.includes(k));
const fieldsLabel = (ex) => fieldsOf(ex).map((k) => FIELDS[k].label).join(' · ');

// миграция старых данных (ex.type -> ex.fields, удаление подписи)
function migrate() {
for (const ex of db.exercises) {
  if (!ex.fields) ex.fields = LEGACY[ex.type] || ['reps'];
  if (ex.type === 'count') for (const e of entriesOf(ex.id)) e.sets = e.sets.map((s) => ({ reps: s.n }));
  delete ex.type; delete ex.note;
}
}
migrate();

const num = (v) => {
  const x = parseFloat(String(v ?? '').replace(',', '.').trim());
  return Number.isFinite(x) ? x : null;
};
const sum = (a) => a.reduce((s, x) => s + (x || 0), 0);
const fmtNum = (x) => (Math.round(x * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
function fmtTime(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function toStored(ex, d) {
  const out = {};
  let any = false;
  for (const k of fieldsOf(ex)) {
    if (k === 'time') {
      const m = num(d.min), s = num(d.s);
      if (m != null || s != null) { out.sec = (m || 0) * 60 + (s || 0); any = true; }
    } else {
      const key = k === 'distance' ? 'km' : k;
      const v = num(d[key]);
      if (v != null) { out[key] = v; any = true; }
    }
  }
  return any ? out : null;
}
function toDraft(ex, s) {
  const str = (x) => (x == null || x === 0 ? '' : String(x).replace('.', ','));
  const d = { weight: str(s.weight), reps: str(s.reps), km: str(s.km) };
  if (s.sec) { d.min = str(Math.floor(s.sec / 60)); d.s = str(Math.round(s.sec % 60)); }
  return d;
}

function setText(s) {
  const p = [];
  if (s.weight != null && s.reps != null) p.push(`${fmtNum(s.weight)} кг × ${fmtNum(s.reps)}`);
  else if (s.weight != null) p.push(`${fmtNum(s.weight)} кг`);
  else if (s.reps != null) p.push(fmtNum(s.reps));
  if (s.km != null) p.push(`${fmtNum(s.km)} км`);
  if (s.sec != null) p.push(fmtTime(s.sec));
  return p.join(' · ');
}
function summary(ex, entry) {
  const S = entry.sets.map(setText);
  if (S.length > 1 && S.every((x) => x === S[0])) {
    const s = entry.sets[0];
    if (s.weight != null && s.reps != null && s.km == null && s.sec == null) return `${fmtNum(s.weight)} кг · ${S.length} × ${fmtNum(s.reps)}`;
    return `${S.length} × ${S[0]}`;
  }
  return S.join(', ');
}

// метрики для графика, зависят от выбранных полей
function metricsOf(ex) {
  const f = new Set(ex.fields), M = [];
  if (f.has('weight')) M.push({ k: 'maxw', label: 'Вес', unit: 'кг', agg: 'max', fn: (S) => Math.max(...S.map((s) => s.weight || 0)) });
  if (f.has('weight') && f.has('reps')) M.push({ k: 'vol', label: 'Объём', unit: 'кг', agg: 'sum', fn: (S) => sum(S.map((s) => (s.weight || 0) * (s.reps || 0))) });
  if (f.has('reps')) M.push({ k: 'reps', label: 'Повторения', unit: '', agg: 'sum', fn: (S) => sum(S.map((s) => s.reps)) });
  if (f.has('distance')) M.push({ k: 'km', label: 'Дистанция', unit: 'км', agg: 'sum', fn: (S) => sum(S.map((s) => s.km)) });
  if (f.has('time')) M.push({ k: 'time', label: 'Время', time: true, agg: 'sum', fn: (S) => sum(S.map((s) => s.sec)) });
  if (f.has('distance') && f.has('time')) M.push({ k: 'pace', label: 'Темп', time: true, agg: 'min', lowerBetter: true, fn: (S) => { const km = sum(S.map((s) => s.km)), sec = sum(S.map((s) => s.sec)); return km > 0 && sec > 0 ? sec / km : null; } });
  return M;
}
const fmtMetric = (m, v) => (m.time ? fmtTime(v) : fmtNum(v) + (m.unit ? ' ' + m.unit : ''));

function series(ex, m) {
  const byDay = new Map();
  for (const e of entriesOf(ex.id)) {
    const v = m.fn(e.sets);
    if (v == null || !Number.isFinite(v)) continue;
    const cur = byDay.get(e.date);
    byDay.set(e.date, cur == null ? v : m.agg === 'sum' ? cur + v : m.agg === 'min' ? Math.min(cur, v) : Math.max(cur, v));
  }
  return [...byDay].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/* ================= даты ================= */

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => iso(new Date());
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
const fmtLong = (s) => parseISO(s).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
function fmtShort(s) {
  const d = parseISO(s), now = new Date();
  if (s === today()) return 'сегодня';
  if (s === addDays(today(), -1)) return 'вчера';
  const o = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== now.getFullYear()) o.year = 'numeric';
  return d.toLocaleDateString('ru-RU', o).replace(' г.', '');
}
const weekKey = (s) => { const d = parseISO(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };

/* ================= утилиты UI ================= */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $view = document.getElementById('view');
const $sheet = document.getElementById('sheet');
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

const state = {
  tab: 'stats',
  date: today(),
  exId: null,       // открытое упражнение во вкладке «Упражнения»
  metric: null,
  calMonth: (() => { const d = new Date(); return [d.getFullYear(), d.getMonth()]; })(),
};

/* ================= рендер вкладок ================= */

function render() {
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  const views = { stats: viewStats, settings: state.exId ? viewExDetail : viewSettings };
  $view.innerHTML = views[state.tab]();
}

function viewLog() {
  const list = db.entries.filter((e) => e.date === state.date).sort((a, b) => a.createdAt - b.createdAt);
  const isToday = state.date === today();
  const title = isToday ? 'Сегодня' : state.date === addDays(today(), -1) ? 'Вчера' : fmtShort(state.date);
  return `
    <div class="daynav" id="day">
      <button class="round" data-act="day-prev" aria-label="Предыдущий день">‹</button>
      <label class="date-title">
        <b>${esc(title)}</b><small>${esc(fmtLong(state.date))}</small>
        <input type="date" id="logDate" value="${state.date}">
      </label>
      <button class="round" data-act="day-next" aria-label="Следующий день">›</button>
    </div>
    ${isToday ? '' : '<button class="today-link" data-act="day-today">Вернуться к сегодня</button>'}
    ${list.length ? list.map((e) => {
      const ex = getEx(e.exerciseId);
      if (!ex) return '';
      return `<button class="card entry" data-act="edit-entry" data-id="${e.id}">
        <div class="name">${esc(ex.name)}${ex.group ? `<span class="tag">${esc(ex.group)}</span>` : ''}</div>
        <div class="sum">${esc(summary(ex, e))}</div>
        ${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}
      </button>`;
    }).join('') : `<div class="empty"><div class="big">🗓️</div>${isToday ? 'Сегодня пока ничего не записано' : 'В этот день записей нет'}</div>`}
`;
}

function exListHTML(act) {
  const active = db.exercises.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const lastDate = {};
  for (const e of db.entries) if (!lastDate[e.exerciseId] || e.date > lastDate[e.exerciseId]) lastDate[e.exerciseId] = e.date;
  const groups = new Map();
  for (const x of active) {
    const g = x.group || '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(x);
  }
  const keys = [...groups.keys()].sort((a, b) => (!a ? 1 : !b ? -1 : a.localeCompare(b, 'ru')));
  const showHeads = keys.length > 1 || keys[0];
  return keys.map((g) => `
    <div class="ex-group">
      ${showHeads ? `<div class="group-title">${esc(g || 'Без группы')}</div>` : ''}
      <div class="list">
        ${groups.get(g).map((x) => `
          <button class="list-item" data-act="${act}" data-id="${x.id}" data-search="${esc((x.name + ' ' + (x.group || '')).toLowerCase())}">
            <div class="grow"><div class="li-title">${esc(x.name)}</div><div class="li-sub">${esc(fieldsLabel(x))}</div></div>
            <div class="li-meta">${lastDate[x.id] ? esc(fmtShort(lastDate[x.id])) : ''}</div>
            <span class="chev">›</span>
          </button>`).join('')}
      </div>
    </div>`).join('');
}

function viewExList() {
  return `
    <div class="top"><h1>Упражнения</h1><button class="round accent" data-act="ex-new" aria-label="Новое упражнение">＋</button></div>
    ${db.exercises.length ? `<input class="search" type="search" placeholder="Поиск" data-filter="#exl">
      <div id="exl">${exListHTML('ex-open')}</div>`
      : `<div class="empty"><div class="big">🏋️</div>Создай первое упражнение — например «Приседания со штангой» или «Планка»
         <button class="btn" data-act="ex-new">Создать упражнение</button></div>`}`;
}

function chartSVG(points, m) {
  if (!points.length) return '<div class="empty small">Пока нет данных за этот период</div>';
  const W = 340, H = 180, pl = 6, pr = 6, pt = 18, pb = 36;
  const xs = points.map((p) => parseISO(p[0]).getTime()), ys = points.map((p) => p[1]);
  let x0 = Math.min(...xs), x1 = Math.max(...xs);
  if (x0 === x1) { x0 -= 864e5; x1 += 864e5; }
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y0 === y1) { y0 = y0 > 0 ? y0 * 0.8 : y0 - 1; y1 = y1 > 0 ? y1 * 1.2 : y1 + 1; }
  const padY = (y1 - y0) * 0.08; y0 -= padY; y1 += padY;
  const X = (t) => pl + ((t - x0) / (x1 - x0)) * (W - pl - pr);
  const Y = (v) => pt + (1 - (v - y0) / (y1 - y0)) * (H - pt - pb);
  const pts = points.map((p, i) => [X(xs[i]), Y(p[1])]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const area = `${line}L${pts[pts.length - 1][0].toFixed(1)},${H - pb}L${pts[0][0].toFixed(1)},${H - pb}Z`;
  const best = m.lowerBetter ? Math.min(...ys) : Math.max(...ys);
  const hi = Math.max(...ys), lo = Math.min(...ys);
  const short = (s) => parseISO(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="График: ${esc(m.label)}">
    <line class="grid" x1="${pl}" x2="${W - pr}" y1="${Y(hi)}" y2="${Y(hi)}"/>
    <line class="grid" x1="${pl}" x2="${W - pr}" y1="${Y(lo)}" y2="${Y(lo)}"/>
    <text class="axis" x="${pl}" y="${Y(hi) - 4}">${esc(fmtMetric(m, hi))}</text>
    ${hi !== lo ? `<text class="axis" x="${W - pr}" y="${Y(lo) + 13}" text-anchor="end">${esc(fmtMetric(m, lo))}</text>` : ''}
    ${points.length > 1 ? `<path class="area" d="${area}"/><path class="line" d="${line}"/>` : ''}
    ${points.length <= 60 ? pts.map((p, i) => `<circle class="dot${ys[i] === best ? ' best' : ''}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${points.length > 25 ? 2.5 : 3.5}"/>`).join('') : ''}
    <text class="axis" x="${pl}" y="${H - 5}">${esc(short(points[0][0]))}</text>
    ${points.length > 1 ? `<text class="axis" x="${W - pr}" y="${H - 5}" text-anchor="end">${esc(short(points[points.length - 1][0]))}</text>` : ''}
  </svg>`;
}

function viewExDetail() {
  const ex = getEx(state.exId);
  if (!ex) { state.exId = null; return viewExList(); }
  const metrics = metricsOf(ex);
  const m = metrics.find((x) => x.k === state.metric) || metrics[0];
  const pts = m ? series(ex, m) : [];
  const hist = entriesOf(ex.id).sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
  return `
    <div class="top"><button class="back" data-act="ex-back">‹ Настройки</button>
      <div class="actions"><button class="round" data-act="ex-edit" aria-label="Изменить">✎</button><button class="round accent" data-act="ex-log" aria-label="Записать">＋</button></div></div>
    <div class="detail-head">
      <h2>${esc(ex.name)}</h2>
      ${ex.group ? `<div class="meta">${esc(ex.group)}</div>` : ''}
    </div>
    ${pts.length > 1 ? `<div class="card chart">
      ${metrics.length > 1 ? `<div class="chips">${metrics.map((x) => `<button class="chip${x.k === m.k ? ' on' : ''}" data-act="metric" data-k="${x.k}">${esc(x.label)}</button>`).join('')}</div>` : ''}
      ${chartSVG(pts, m)}
    </div>` : ''}
    ${hist.length ? `<div class="list" style="margin-top:12px">${hist.map((e) => `
      <button class="list-item" data-act="edit-entry" data-id="${e.id}">
        <div class="grow"><div class="hist-date">${esc(fmtShort(e.date))}</div><div class="li-title">${esc(summary(ex, e))}</div>${e.note ? `<div class="li-sub">${esc(e.note)}</div>` : ''}</div>
      </button>`).join('')}</div>` : '<div class="empty">Записей пока нет<button class="btn" data-act="ex-log">＋ Записать</button></div>'}`;
}

function viewStats() {
  const [y, mo] = state.calMonth;
  const first = new Date(y, mo, 1);
  const offset = (first.getDay() + 6) % 7;
  const nDays = new Date(y, mo + 1, 0).getDate();
  const perDay = new Map();
  for (const e of db.entries) {
    if (!perDay.has(e.date)) perDay.set(e.date, new Set());
    perDay.get(e.date).add(e.exerciseId);
  }
  const t = today();
  let cells = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => `<div class="wd">${d}</div>`).join('');
  cells += '<div class="d blank"></div>'.repeat(offset);
  let monthDays = 0;
  const monthEx = new Map();
  for (let d = 1; d <= nDays; d++) {
    const s = iso(new Date(y, mo, d));
    const n = perDay.get(s)?.size || 0;
    if (n) {
      monthDays++;
      for (const id of perDay.get(s)) monthEx.set(id, (monthEx.get(id) || 0) + 1);
    }
    const lvl = n === 0 ? '' : n <= 2 ? ' l1' : n <= 4 ? ' l2' : ' l3';
    cells += `<button class="d${lvl}${s === t ? ' today' : ''}${s === state.date ? ' sel' : ''}${s > t ? ' future' : ''}" data-act="cal-day" data-date="${s}">${d}</button>`;
  }
  // серия: недели подряд хотя бы с одной тренировкой (текущая неделя может быть ещё пустой)
  const weeks = new Set([...perDay.keys()].map(weekKey));
  let wk = weekKey(t), streak = 0;
  if (!weeks.has(wk)) wk = addDays(wk, -7);
  while (weeks.has(wk)) { streak++; wk = addDays(wk, -7); }
  const monthName = first.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '');
  const top = [...monthEx].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c; };
  return `
    <div class="top"><h1>Прогресс</h1></div>
    <div class="kpis">
      <div class="kpi"><b>${monthDays}</b><span>${plural(monthDays, 'день', 'дня', 'дней')} в месяце</span></div>
      <div class="kpi"><b>${streak}</b><span>${plural(streak, 'неделя', 'недели', 'недель')} подряд</span></div>
      <div class="kpi"><b>${perDay.size}</b><span>всего дней</span></div>
    </div>
    <div class="card">
      <div class="cal-head">
        <button class="round" data-act="cal-prev" aria-label="Предыдущий месяц">‹</button>
        <b>${esc(monthName)}</b>
        <button class="round" data-act="cal-next" aria-label="Следующий месяц">›</button>
      </div>
      <div class="cal">${cells}</div>
    </div>
    ${viewLog()}
    <div class="group-title">Упражнения за месяц</div>
    ${top.length ? `<div class="list">${top.map(([id, n]) => {
      const ex = getEx(id);
      return ex ? `<button class="list-item" data-act="stats-ex" data-id="${id}">
        <div class="grow"><div class="li-title">${esc(ex.name)}</div></div>
        <div class="li-meta">${n} ${plural(n, 'раз', 'раза', 'раз')}</div><span class="chev">›</span></button>` : '';
    }).join('')}</div>` : '<div class="empty small">В этом месяце тренировок нет</div>'}
    <button class="fab" data-act="add-entry">＋ Записать</button>`;
}

function viewSettings() {
  return `
    <div class="top"><h1>Настройки</h1></div>
    <div class="settings">
      <div class="top" style="min-height:0;margin-top:8px"><h3 style="margin:0 4px">Упражнения</h3><button class="round accent" data-act="ex-new" aria-label="Новое упражнение">＋</button></div>
      ${db.exercises.length ? `<div id="exl">${exListHTML('ex-open')}</div>`
        : '<div class="empty small">Упражнений пока нет<button class="btn" data-act="ex-new">Создать упражнение</button></div>'}
      <h3>Цвет</h3>
      <div class="card"><div class="swatches">${ACCENTS.map(([k, rgb, name]) => `<button class="swatch${k === accent ? ' on' : ''}" style="background:rgb(${rgb})" data-act="accent" data-k="${k}" aria-label="${name}"></button>`).join('')}</div></div>
      <h3>Синхронизация</h3>
      ${syncHTML()}
      <h3>Опасная зона</h3>
      <button class="btn danger" data-act="wipe">Удалить все данные</button>
    </div>`;
}

const ACCENTS = [['orange', '240, 83, 60', 'Оранжевый'], ['blue', '14, 132, 230', 'Голубой'], ['green', '22, 163, 74', 'Зелёный'],
  ['purple', '124, 58, 237', 'Фиолетовый'], ['teal', '13, 148, 136', 'Бирюзовый'], ['lime', '101, 163, 13', 'Лаймовый']];
let accent = localStorage.getItem('trenirovki.accent') || 'orange';
const applyAccent = () => { if (accent === 'orange') delete document.documentElement.dataset.accent; else document.documentElement.dataset.accent = accent; };
applyAccent();

function syncHTML() {
  if (!Sync.configured()) return '<div class="card muted">Supabase не настроен: заполни config.js.</div>';
  if (!Sync.user) return `<div class="card sync-form">
      <p class="muted" style="margin:0 0 10px">Войди, чтобы данные сохранялись в облаке и не терялись.</p>
      <input type="email" id="syncEmail" placeholder="Почта" autocomplete="email">
      <input type="password" id="syncPass" placeholder="Пароль из 6 цифр" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="current-password">
      ${Sync.status ? `<p class="muted" style="color:var(--danger)">${esc(Sync.status)}</p>` : ''}
      <button class="btn" data-act="sync-in">Войти</button>
      <button class="btn ghost" data-act="sync-up">Создать аккаунт</button>
    </div>`;
  const st = Sync.status || (Sync.pending() ? 'Есть несохранённые изменения' : Sync.lastOk ? `Синхронизировано в ${new Date(Sync.lastOk).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : 'Синхронизировано');
  return `<div class="card"><p style="margin:0 0 4px"><b>${esc(Sync.user)}</b></p><p class="muted" style="margin:0">${esc(st)}</p>
    <button class="btn ghost" data-act="sync-now">Синхронизировать сейчас</button>
    <button class="btn danger" data-act="sync-out">Выйти</button></div>`;
}

/* ================= шторки (bottom sheet) ================= */

let sheetRender = null;
function openSheet(fn) {
  sheetRender = fn;
  $sheet.innerHTML = `<div class="sheet-backdrop" data-act="close-sheet"></div><div class="sheet">${fn()}</div>`;
  requestAnimationFrame(() => $sheet.classList.add('open'));
}
function rerenderSheet() {
  const box = $sheet.querySelector('.sheet');
  if (box && sheetRender) { const top = box.scrollTop; box.innerHTML = sheetRender(); box.scrollTop = top; }
}
function closeSheet() {
  $sheet.classList.remove('open');
  sheetRender = null;
  setTimeout(() => { if (!sheetRender) $sheet.innerHTML = ''; }, 260);
}

// --- выбор упражнения для записи ---
function openPicker() {
  openSheet(() => `
    <div class="sheet-head"><button class="link" data-act="close-sheet">Отмена</button><div class="sheet-title">Что делал?</div><button class="link strong" data-act="picker-new">Новое</button></div>
    ${db.exercises.length ? `<div id="pickl">${exListHTML('pick-ex')}</div>`
      : `<div class="empty small">Упражнений ещё нет<button class="btn" data-act="picker-new">Создать упражнение</button></div>`}`);
}

// --- форма записи выполнения ---
let draft = null;
function lastEntry(exId, exceptId) {
  return entriesOf(exId).filter((e) => e.id !== exceptId)
    .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1))[0];
}
function openEntryForm(exId, entry, date) {
  const ex = getEx(exId);
  draft = entry
    ? { exId, entryId: entry.id, date: entry.date, note: entry.note || '', sets: entry.sets.map((s) => toDraft(ex, s)) }
    : { exId, entryId: null, date: date || today(), note: '', sets: [{}] };
  openSheet(renderEntryForm);
}
function renderEntryForm() {
  const ex = getEx(draft.exId), inputs = fieldsOf(ex).flatMap((k) => FIELDS[k].inputs);
  const last = lastEntry(ex.id, draft.entryId);
  return `
    <div class="sheet-head"><button class="link" data-act="close-sheet">Отмена</button><div class="sheet-title">${esc(ex.name)}</div><button class="link strong" data-act="entry-save">Готово</button></div>
    ${last ? `<div class="last"><div><span class="muted">Прошлый раз · ${esc(fmtShort(last.date))}</span><br>${esc(summary(ex, last))}</div>
      ${draft.entryId ? '' : '<button class="chip" data-act="repeat-last">Повторить</button>'}</div>` : ''}
    <div class="sets">${draft.sets.map((s, i) => `
      <div class="set-row">
        <span class="set-n">${i + 1}</span>
        ${inputs.map(([k, lab, mode]) => `<label class="fld"><input type="text" inputmode="${mode}" autocomplete="off" data-set="${i}" data-k="${k}" value="${esc(s[k] ?? '')}" placeholder="0"><span>${lab}</span></label>`).join('')}
        ${draft.sets.length > 1 ? `<button class="icon-btn" data-act="set-del" data-i="${i}" aria-label="Удалить подход">✕</button>` : ''}
      </div>`).join('')}
    </div>
    <button class="btn ghost" data-act="set-add">＋ Подход</button>
    <label class="row-field"><span>Дата</span><input type="date" data-draft="date" value="${draft.date}"></label>
    <textarea data-draft="note" placeholder="Заметка (необязательно)">${esc(draft.note)}</textarea>
    ${draft.entryId ? '<button class="btn danger" data-act="entry-delete">Удалить запись</button>' : ''}`;
}

// --- форма упражнения ---
let exDraft = null, exAfterSave = null;
function openExerciseForm(ex, afterSave) {
  exDraft = ex ? { ...ex, group: ex.group || '', fields: [...ex.fields] } : { id: null, name: '', group: '', fields: ['weight', 'reps'] };
  exAfterSave = afterSave || null;
  openSheet(renderExForm);
  if (!ex) setTimeout(() => $sheet.querySelector('[data-exd="name"]')?.focus(), 300);
}
function renderExForm() {
  const groups = [...new Set(db.exercises.map((x) => x.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  return `
    <div class="sheet-head"><button class="link" data-act="close-sheet">Отмена</button><div class="sheet-title">${exDraft.id ? 'Упражнение' : 'Новое упражнение'}</div><button class="link strong" data-act="ex-save">Сохранить</button></div>
    <label class="field"><span>Название</span><input type="text" data-exd="name" value="${esc(exDraft.name)}" placeholder="Например, Жим лёжа" autocomplete="off"></label>
    <label class="field"><span>Группа</span><input type="text" data-exd="group" value="${esc(exDraft.group)}" placeholder="Ноги, спина, кардио…" list="groupList" autocomplete="off">
      <datalist id="groupList">${groups.map((g) => `<option value="${esc(g)}">`).join('')}</datalist></label>
    <div class="field"><span>Что записываем</span>
      <div class="chips">${FIELD_KEYS.map((k) => `<button class="chip${exDraft.fields.includes(k) ? ' on' : ''}" data-act="field-toggle" data-k="${k}">${FIELDS[k].label}</button>`).join('')}</div>
    </div>
    ${exDraft.id ? '<button class="btn danger" data-act="ex-delete">Удалить упражнение</button>' : ''}`;
}

/* ================= действия ================= */

const actions = {
  tab(el) {
    const tab = el.dataset.tab;
    if (state.tab === tab && tab === 'settings') state.exId = null;
    state.tab = tab;
    render();
    window.scrollTo(0, 0);
  },
  'day-prev'() { state.date = addDays(state.date, -1); render(); },
  'day-next'() { state.date = addDays(state.date, 1); render(); },
  'day-today'() { state.date = today(); render(); },
  'add-entry'() { openPicker(); },
  'pick-ex'(el) { openEntryForm(el.dataset.id, null, state.date); },
  'picker-new'() { openExerciseForm(null, (ex) => openEntryForm(ex.id, null, state.date)); },
  'edit-entry'(el) { const e = getEntry(el.dataset.id); if (e) openEntryForm(e.exerciseId, e); },
  'close-sheet'() { closeSheet(); },

  'set-add'() {
    const lastSet = draft.sets[draft.sets.length - 1] || {};
    draft.sets.push({ ...lastSet });
    rerenderSheet();
  },
  'set-del'(el) { draft.sets.splice(Number(el.dataset.i), 1); rerenderSheet(); },
  'repeat-last'() {
    const ex = getEx(draft.exId), last = lastEntry(ex.id, draft.entryId);
    if (last) { draft.sets = last.sets.map((s) => toDraft(ex, s)); rerenderSheet(); }
  },
  'entry-save'() {
    const ex = getEx(draft.exId);
    const sets = draft.sets.map((s) => toStored(ex, s)).filter(Boolean);
    if (!sets.length) { toast('Заполни хотя бы одно значение'); return; }
    const date = draft.date || today();
    if (draft.entryId) {
      Object.assign(getEntry(draft.entryId), { sets, date, note: draft.note.trim() });
    } else {
      db.entries.push({ id: uid(), exerciseId: ex.id, date, sets, note: draft.note.trim(), createdAt: Date.now() });
    }
    saveDB();
    closeSheet();
    if (!draft.entryId) state.date = date;
    render();
    toast('Сохранено ✓');
  },
  'entry-delete'() {
    if (!confirm('Удалить эту запись?')) return;
    db.entries = db.entries.filter((e) => e.id !== draft.entryId);
    saveDB(); closeSheet(); render();
  },

  'ex-new'() { openExerciseForm(null, (ex) => { state.exId = ex.id; state.metric = null; render(); }); },
  'ex-open'(el) { state.exId = el.dataset.id; state.metric = null; render(); window.scrollTo(0, 0); },
  'ex-back'() { state.exId = null; render(); },
  'ex-edit'() { openExerciseForm(getEx(state.exId)); },
  'ex-log'() { openEntryForm(state.exId, null, today()); },
  'ex-save'() {
    const name = exDraft.name.trim();
    if (!name) { toast('Введи название'); return; }
    if (!exDraft.fields.length) { toast('Выбери, что записываем'); return; }
    const data = { name, group: exDraft.group.trim(), fields: [...exDraft.fields] };
    let ex;
    if (exDraft.id) { ex = getEx(exDraft.id); Object.assign(ex, data); }
    else { ex = { id: uid(), createdAt: Date.now(), ...data }; db.exercises.push(ex); }
    saveDB();
    const after = exAfterSave;
    closeSheet();
    render();
    if (after) setTimeout(() => after(ex), 280);
  },
  'ex-delete'() {
    const n = entriesOf(exDraft.id).length;
    if (!confirm(`Удалить «${exDraft.name}»${n ? ` и ${n} записей по нему` : ''}? Это нельзя отменить.`)) return;
    db.entries = db.entries.filter((e) => e.exerciseId !== exDraft.id);
    db.exercises = db.exercises.filter((x) => x.id !== exDraft.id);
    saveDB(); closeSheet(); state.exId = null; render();
  },
  'field-toggle'(el) {
    const k = el.dataset.k, f = exDraft.fields;
    exDraft.fields = f.includes(k) ? f.filter((x) => x !== k) : [...f, k];
    rerenderSheet();
  },
  metric(el) { state.metric = el.dataset.k; render(); },

  'cal-prev'() { const [y, m] = state.calMonth; state.calMonth = m === 0 ? [y - 1, 11] : [y, m - 1]; render(); },
  'cal-next'() { const [y, m] = state.calMonth; state.calMonth = m === 11 ? [y + 1, 0] : [y, m + 1]; render(); },
  'cal-day'(el) { state.date = el.dataset.date; render(); document.getElementById('day')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  'stats-ex'(el) { state.tab = 'settings'; state.exId = el.dataset.id; state.metric = null; render(); window.scrollTo(0, 0); },

  async export() {
    const name = `trenirovki-${today()}.json`;
    const file = new File([JSON.stringify(db, null, 1)], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  import() { document.getElementById('importFile').click(); },
  accent(el) {
    accent = el.dataset.k;
    try { localStorage.setItem('trenirovki.accent', accent); } catch (e) { /* не страшно */ }
    applyAccent(); render();
  },
  async 'sync-in'(el, e, up) {
    const email = document.getElementById('syncEmail').value.trim(), pass = document.getElementById('syncPass').value;
    if (!email || !/^\d{6}$/.test(pass)) { toast('Введи почту и пароль из 6 цифр'); return; }
    el.disabled = true;
    try {
      if (up) { if (!(await Sync.signUp(email, pass))) { alert('Проверь почту и подтверди аккаунт, затем нажми «Войти».'); render(); return; } }
      else await Sync.signIn(email, pass);
      toast('Готово ✓');
    } catch (err) { toast(err.message); }
    render();
  },
  'sync-up'(el, e) { return actions['sync-in'](el, e, true); },
  'sync-now'() { Sync.run(); },
  'sync-out'() { if (confirm('Выйти? Данные на телефоне останутся, но перестанут синхронизироваться.')) { Sync.signOut(); render(); } },
  wipe() {
    if (!confirm('Удалить все упражнения и записи с этого телефона?')) return;
    if (!confirm('Точно? Восстановить можно будет только из резервной копии.')) return;
    db = { version: 1, exercises: [], entries: [] };
    saveDB(); render(); toast('Данные удалены');
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.set != null && draft) draft.sets[Number(t.dataset.set)][t.dataset.k] = t.value;
  else if (t.dataset.draft && draft) draft[t.dataset.draft] = t.value;
  else if (t.dataset.exd && exDraft) exDraft[t.dataset.exd] = t.value;
  else if (t.dataset.filter) {
    const q = t.value.trim().toLowerCase();
    const root = document.querySelector(t.dataset.filter);
    root.querySelectorAll('[data-search]').forEach((it) => { it.hidden = q && !it.dataset.search.includes(q); });
    root.querySelectorAll('.ex-group').forEach((g) => { g.hidden = !g.querySelector('[data-search]:not([hidden])'); });
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'logDate' && t.value) { state.date = t.value; render(); }
  else if (t.id === 'importFile' && t.files[0]) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (!Array.isArray(d.exercises) || !Array.isArray(d.entries)) throw new Error('не тот формат');
        if (!confirm(`В файле ${d.exercises.length} упражнений и ${d.entries.length} записей. Заменить текущие данные?`)) return;
        db = d; migrate(); saveDB(); render(); toast('Данные восстановлены');
      } catch (err) { alert('Не получилось прочитать файл: ' + err.message); }
      finally { t.value = ''; }
    };
    reader.readAsText(t.files[0]);
  }
});

// Enter в поле подхода — переход к следующему полю
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.matches('.fld input')) return;
  e.preventDefault();
  const inputs = [...$sheet.querySelectorAll('.fld input')];
  const next = inputs[inputs.indexOf(e.target) + 1];
  if (next) next.focus(); else e.target.blur();
});

// если приложение было свёрнуто через полночь — «сегодня» должно обновиться
let lastToday = today();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && today() !== lastToday) {
    if (state.date === lastToday) state.date = today();
    lastToday = today();
    if (!sheetRender) render();
  }
  if (document.visibilityState === 'visible') Sync.run();
});

/* ================= старт ================= */

Sync.init(() => db, (d) => { db = d; migrate(); saveDB(true); if (!sheetRender) render(); }, () => { if (state.tab === 'settings' && !state.exId && !sheetRender && !document.activeElement?.closest('.sync-form')) render(); });
render();
Sync.run();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
