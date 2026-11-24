'use strict';
// Синхронизация с Supabase через REST (без сторонних библиотек).
// Весь db хранится одной JSON-строкой в таблице user_data; побеждает более свежая версия (db.updatedAt).

const Sync = (() => {
  const URL_ = (window.SUPABASE_URL || '').replace(/\/$/, '');
  const KEY = window.SUPABASE_ANON_KEY || '';
  const S_KEY = 'trenirovki.session';
  const SYNCED_KEY = 'trenirovki.syncedAt';
  let session = null;
  try { session = JSON.parse(localStorage.getItem(S_KEY)); } catch (e) { /* нет сессии */ }
  let status = '';            // текст для настроек
  let lastOk = 0;
  let timer = null, busy = false, again = false;
  let onChange = () => {};

  const configured = () => Boolean(URL_ && KEY);
  const setStatus = (s) => { status = s; onChange(); };
  const saveSession = (s) => {
    session = s;
    if (s) localStorage.setItem(S_KEY, JSON.stringify(s)); else localStorage.removeItem(S_KEY);
  };
  const syncedAt = () => Number(localStorage.getItem(SYNCED_KEY) || 0);

  async function authCall(path, body) {
    const r = await fetch(`${URL_}/auth/v1/${path}`, {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.msg || j.message || `Ошибка ${r.status}`);
    return j;
  }
  function takeTokens(j) {
    saveSession({
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
      email: j.user?.email || session?.email || '',
      user_id: j.user?.id || session?.user_id,
    });
  }
  async function token() {
    if (!session) throw new Error('Не выполнен вход');
    if (session.expires_at - 60 < Date.now() / 1000) {
      try { takeTokens(await authCall('token?grant_type=refresh_token', { refresh_token: session.refresh_token })); }
      catch (e) {
        if (navigator.onLine) { saveSession(null); setStatus('Сессия истекла, войди снова'); }
        throw e;
      }
    }
    return session.access_token;
  }
  async function rest(method, query, body, extra = {}) {
    const r = await fetch(`${URL_}/rest/v1/user_data${query}`, {
      method,
      headers: { apikey: KEY, Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json', ...extra },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.message || `Ошибка ${r.status}`); }
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  }

  // getDB/setDB передаются из app.js
  let getDB, setDB;

  async function run() {
    if (!configured() || !session) return;
    if (busy) { again = true; return; }
    busy = true;
    try {
      setStatus('Синхронизация…');
      const rows = await rest('GET', `?select=data&user_id=eq.${session.user_id}`);
      const remote = rows[0]?.data;
      const local = getDB();
      const lu = local.updatedAt || 0, ru = remote?.updatedAt || 0;
      if (remote && ru > lu) {
        setDB(remote);
        localStorage.setItem(SYNCED_KEY, String(ru));
      } else if (!remote || lu > ru) {
        await rest('POST', '', { user_id: session.user_id, data: local, updated_at: new Date().toISOString() },
          { Prefer: 'resolution=merge-duplicates,return=minimal' });
        localStorage.setItem(SYNCED_KEY, String(lu));
      } else {
        localStorage.setItem(SYNCED_KEY, String(lu)); // версии совпадают
      }
      lastOk = Date.now();
      setStatus('');
    } catch (e) {
      setStatus(navigator.onLine ? e.message : 'Нет сети — синхронизирую позже');
    } finally {
      busy = false;
      if (again) { again = false; run(); }
    }
  }

  return {
    init(get, set, changed) { getDB = get; setDB = set; onChange = changed; },
    configured,
    get user() { return session?.email || null; },
    get status() { return status; },
    get lastOk() { return lastOk; },
    pending: () => (getDB().updatedAt || 0) > syncedAt(),
    schedule() { clearTimeout(timer); timer = setTimeout(run, 1500); },
    run,
    async signIn(email, password) {
      takeTokens(await authCall('token?grant_type=password', { email, password }));
      await run();
    },
    async signUp(email, password) {
      const j = await authCall('signup', { email, password });
      if (j.access_token) { takeTokens(j); await run(); return true; }
      return false; // нужно подтвердить почту
    },
    signOut() { saveSession(null); localStorage.removeItem(SYNCED_KEY); setStatus(''); },
  };
})();

window.addEventListener('online', () => Sync.run());
