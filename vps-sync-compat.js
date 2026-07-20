// Firebase-compatible client facade backed by the first-party VPS API.
// It intentionally exposes only the subset used by cloud-sync.js.

const API = location.pathname.startsWith('/migration-preview/') ? '/api-preview/v1' : '/api/v1';
const documentVersions = new Map();

function csrfToken() {
  const item = document.cookie.split(';').map(v => v.trim()).find(v => v.startsWith('ege_csrf='));
  if (!item) return '';
  try { return decodeURIComponent(item.slice(item.indexOf('=') + 1)); } catch (_) { return ''; }
}

async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (options.method && !['GET', 'HEAD', 'OPTIONS'].includes(options.method.toUpperCase())) {
    const csrf = csrfToken();
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
  let payload = null;
  try { payload = await response.json(); } catch (_) {}
  if (!response.ok) {
    const error = new Error(payload?.error || `http_${response.status}`);
    error.status = response.status;
    error.code = payload?.error || `http_${response.status}`;
    error.details = payload?.details;
    throw error;
  }
  return payload;
}

function normalizeUser(raw) {
  if (!raw) return null;
  return {
    uid: String(raw.uid || ''),
    displayName: raw.displayName || '',
    email: raw.email || '',
    isAnonymous: !!raw.isAnonymous,
    providerData: Array.isArray(raw.providerData) ? raw.providerData : [],
    canonicalDocId: raw.canonicalDocId || '',
  };
}

const authSingleton = {
  currentUser: null,
  listeners: new Set(),
  initialized: false,
  initPromise: null,
};

function notifyAuth() {
  for (const listener of [...authSingleton.listeners]) {
    try { listener(authSingleton.currentUser); } catch (error) { setTimeout(() => { throw error; }, 0); }
  }
}

async function loadSession({ notify = true } = {}) {
  try {
    const payload = await apiFetch(`${API}/auth/session`);
    authSingleton.currentUser = normalizeUser(payload.user);
  } catch (error) {
    if (error.status !== 401) throw error;
    authSingleton.currentUser = null;
  }
  authSingleton.initialized = true;
  if (notify) notifyAuth();
  return authSingleton.currentUser;
}

function ensureAuthInit() {
  if (!authSingleton.initPromise) authSingleton.initPromise = loadSession({ notify: false }).catch(() => null);
  return authSingleton.initPromise;
}

export function initializeApp(config) { return { config, kind: 'vps-app' }; }
export function getAuth() { ensureAuthInit(); return authSingleton; }
export function initializeFirestore() { return { kind: 'vps-store' }; }

export async function signInAnonymously() {
  await ensureAuthInit();
  const payload = await apiFetch(`${API}/auth/guest`, { method: 'POST', body: '{}' });
  authSingleton.currentUser = normalizeUser(payload.user);
  const legacyId = String(localStorage.getItem('stable_student_id') || '');
  if (legacyId && legacyId !== authSingleton.currentUser.canonicalDocId
      && !/^\d+$/.test(legacyId) && !legacyId.startsWith('google_') && legacyId.length >= 16) {
    try {
      const claimed = await apiFetch(`${API}/auth/legacy/claim`, {
        method: 'POST', body: JSON.stringify({ legacyId })
      });
      if (claimed.user) authSingleton.currentUser = normalizeUser(claimed.user);
    } catch (error) {
      console.warn('[Cloud] Legacy guest profile was not claimed:', error.message);
    }
  }
  authSingleton.initialized = true;
  notifyAuth();
  return { user: authSingleton.currentUser };
}

export async function signInWithCustomToken() {
  await ensureAuthInit();
  const user = await loadSession();
  if (!user) throw new Error('session_missing');
  return { user };
}

export function onAuthStateChanged(auth, listener) {
  auth.listeners.add(listener);
  ensureAuthInit().then(() => listener(auth.currentUser)).catch(() => listener(null));
  return () => auth.listeners.delete(listener);
}

export class GoogleAuthProvider {
  setCustomParameters() {}
  static credentialFromError() { return null; }
}

function googleRedirect() {
  const url = new URL(location.href);
  url.searchParams.delete('auth');
  const returnTo = url.pathname + url.search + url.hash;
  location.assign(`${API}/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`);
  return new Promise(() => {});
}

export function signInWithPopup() { return googleRedirect(); }
export function signInWithRedirect() { return googleRedirect(); }
export function signInWithCredential() { return googleRedirect(); }

export async function getRedirectResult() {
  const url = new URL(location.href);
  if (url.searchParams.get('auth') !== 'google') return null;
  url.searchParams.delete('auth');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  const user = await loadSession();
  return user ? { user } : null;
}

export async function signOut() {
  await apiFetch(`${API}/auth/logout`, { method: 'POST', body: '{}' });
  authSingleton.currentUser = null;
  notifyAuth();
}

export async function refreshVpsAuth() { return loadSession(); }
export { apiFetch as vpsApiFetch };

function joinPath(base, segments) {
  return [base, ...segments].filter(Boolean).join('/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
}

export function collection(parent, ...segments) {
  const base = parent && parent.path ? parent.path : '';
  return { kind: 'collection', path: joinPath(base, segments) };
}

export function doc(parent, ...segments) {
  const base = parent && parent.path ? parent.path : '';
  return { kind: 'doc', path: joinPath(base, segments), id: String(segments[segments.length - 1] || '').replace(/^.*\//, '') };
}

export function where(field, op, value) { return { type: 'where', field, op, value }; }
export function orderBy(field, direction = 'asc') { return { type: 'orderBy', field, direction }; }
export function limit(count) { return { type: 'limit', count: Number(count) || 0 }; }
export function query(collectionRef, ...constraints) {
  return { kind: 'query', path: collectionRef.path, constraints };
}

class VpsDocSnapshot {
  constructor(ref, payload) {
    this.ref = ref;
    this.id = payload?.id || ref.id;
    this._exists = !!payload?.exists;
    this._data = payload?.data || undefined;
    this._version = Number(payload?.version) || 0;
  }
  exists() { return this._exists; }
  data() { return this._data; }
}

class VpsQuerySnapshot {
  constructor(ref, rows) {
    this.query = ref;
    this.docs = (rows || []).map(row => new VpsDocSnapshot(
      { kind: 'doc', path: `${ref.path}/${row.id}`, id: row.id },
      { exists: true, ...row }
    ));
    this.size = this.docs.length;
    this.empty = this.docs.length === 0;
  }
  forEach(callback) { this.docs.forEach(callback); }
}

export async function getDoc(ref) {
  if (/\/public\/data\/leaderboards\/global$/.test(ref.path)) {
    const payload = await apiFetch(`${API}/leaderboards`);
    const top = (payload.rows || []).map(row => ({ ...(row.data || {}), id: row.id }));
    return new VpsDocSnapshot(ref, {
      exists: true,
      id: ref.id,
      data: { top, updatedAt: Date.now() },
      version: 0,
    });
  }
  const payload = await apiFetch(`${API}/store/doc?path=${encodeURIComponent(ref.path)}`);
  documentVersions.set(ref.path, Number(payload.version) || 0);
  return new VpsDocSnapshot(ref, payload);
}

export async function getDocs(ref) {
  const payload = await apiFetch(`${API}/store/query`, {
    method: 'POST', body: JSON.stringify({ path: ref.path, constraints: ref.constraints || [] })
  });
  return new VpsQuerySnapshot(ref, payload.docs);
}

async function writeDoc(ref, data, mode, expectedVersion) {
  // The VPS API builds the public leaderboard from indexed student profiles.
  // Legacy clients still try to refresh the old Firestore cache document; the
  // write is intentionally treated as a successful no-op.
  if (/\/public\/data\/leaderboards\/global$/.test(ref.path)) {
    return { id: ref.id, data, version: 0, unchanged: true };
  }
  const isState = ref.path.includes('/private/data/state/');
  const knownVersion = expectedVersion === undefined && isState ? documentVersions.get(ref.path) : expectedVersion;
  const result = await apiFetch(`${API}/store/doc`, {
    method: 'PUT', body: JSON.stringify({ path: ref.path, data, mode, ...(knownVersion === undefined ? {} : { expectedVersion: knownVersion }) })
  });
  documentVersions.set(ref.path, Number(result.version) || 0);
  return result;
}

export async function setDoc(ref, data, options = {}) {
  return writeDoc(ref, data, options.merge ? 'merge' : 'set');
}

export async function updateDoc(ref, data) { return writeDoc(ref, data, 'update'); }

export async function deleteDoc(ref) {
  const result = await apiFetch(`${API}/store/doc?path=${encodeURIComponent(ref.path)}`, { method: 'DELETE' });
  documentVersions.delete(ref.path);
  return result;
}

export async function addDoc(collectionRef, data) {
  const id = crypto.randomUUID().replace(/-/g, '');
  const ref = { kind: 'doc', path: `${collectionRef.path}/${id}`, id };
  await writeDoc(ref, data, 'set');
  return ref;
}

export function deleteField() { return { __vpsOp: 'delete' }; }
export function arrayUnion(...values) { return { __vpsOp: 'arrayUnion', values }; }
export function arrayRemove(...values) { return { __vpsOp: 'arrayRemove', values }; }

export async function runTransaction(db, handler) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    const reads = new Map();
    const mutations = [];
    const transaction = {
      async get(ref) {
        const snapshot = await getDoc(ref);
        reads.set(ref.path, snapshot._version);
        return snapshot;
      },
      update(ref, data) {
        mutations.push({ type: 'write', path: ref.path, data, mode: 'update', expectedVersion: reads.get(ref.path) });
      },
      set(ref, data, options = {}) {
        mutations.push({ type: 'write', path: ref.path, data, mode: options.merge ? 'merge' : 'set', expectedVersion: reads.get(ref.path) });
      },
      delete(ref) {
        mutations.push({ type: 'delete', path: ref.path, expectedVersion: reads.get(ref.path) });
      },
    };
    const value = await handler(transaction);
    try {
      await apiFetch(`${API}/store/transaction`, { method: 'POST', body: JSON.stringify({ mutations }) });
      return value;
    } catch (error) {
      lastError = error;
      if (error.status !== 409) throw error;
    }
  }
  throw lastError || new Error('transaction_failed');
}

const live = {
  socket: null,
  listeners: new Map(),
  reconnectTimer: null,
  reconnectDelay: 500,
};

function socketUrl() {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${API}/store/ws`;
}

function ensureSocket() {
  if (live.socket && (live.socket.readyState === WebSocket.OPEN || live.socket.readyState === WebSocket.CONNECTING)) return;
  let socket;
  try { socket = new WebSocket(socketUrl()); } catch (_) { return; }
  live.socket = socket;
  socket.addEventListener('open', () => {
    if (live.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
    live.reconnectDelay = 500;
    for (const path of live.listeners.keys()) {
      if (socket.readyState !== WebSocket.OPEN) break;
      socket.send(JSON.stringify({ type: 'subscribe', path }));
    }
  });
  socket.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(event.data); } catch (_) { return; }
    if (message.type !== 'change') return;
    for (const [path, listeners] of live.listeners) {
      if (message.path !== path && message.collectionPath !== path) continue;
      for (const listener of listeners) listener.refresh();
    }
  });
  socket.addEventListener('close', () => {
    if (live.socket === socket) live.socket = null;
    if (!live.listeners.size) return;
    clearTimeout(live.reconnectTimer);
    live.reconnectTimer = setTimeout(ensureSocket, live.reconnectDelay);
    live.reconnectDelay = Math.min(10000, live.reconnectDelay * 2);
  });
}

export function onSnapshot(ref, onNext, onError = () => {}) {
  let stopped = false;
  let refreshing = false;
  let queued = false;
  const listener = {
    async refresh() {
      if (stopped) return;
      if (refreshing) { queued = true; return; }
      refreshing = true;
      try {
        onNext(ref.kind === 'doc' ? await getDoc(ref) : await getDocs(ref));
      } catch (error) { if (!stopped) onError(error); }
      finally {
        refreshing = false;
        if (queued) { queued = false; listener.refresh(); }
      }
    }
  };
  if (!live.listeners.has(ref.path)) live.listeners.set(ref.path, new Set());
  live.listeners.get(ref.path).add(listener);
  ensureSocket();
  listener.refresh();

  // Fallback also heals missed events after mobile suspend.
  const pollMs = ref.path.includes('/matches') ? 1200 : 10000;
  const timer = setInterval(() => { if (document.visibilityState !== 'hidden') listener.refresh(); }, pollMs);
  return () => {
    stopped = true;
    clearInterval(timer);
    const set = live.listeners.get(ref.path);
    if (set) {
      set.delete(listener);
      if (!set.size) {
        live.listeners.delete(ref.path);
        if (live.socket?.readyState === WebSocket.OPEN) live.socket.send(JSON.stringify({ type: 'unsubscribe', path: ref.path }));
      }
    }
    if (!live.listeners.size && live.socket) { live.socket.close(); live.socket = null; }
  };
}
