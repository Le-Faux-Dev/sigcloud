// Client d'API. La session est un cookie HttpOnly (illisible en JavaScript) : seul le jeton CSRF est gardé en mémoire.

export class ApiError extends Error {
  constructor(status, code, message, details, requestId) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

const state = { csrf: null, user: null };
export const session = {
  get user() {
    return state.user;
  },
  set({ user, csrfToken }) {
    state.user = user;
    state.csrf = csrfToken;
  },
  clear() {
    state.user = null;
    state.csrf = null;
  },
};

const BASE = '/api/v1';

async function request(method, path, { json, share, signal, raw } = {}) {
  const headers = { Accept: 'application/json' };
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  if (state.csrf && method !== 'GET') headers['X-CSRF-Token'] = state.csrf;
  if (share) headers['X-Share-Token'] = share;
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: json !== undefined ? JSON.stringify(json) : undefined, credentials: 'same-origin', signal, cache: 'no-store' });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'Impossible de joindre le serveur. Vérifie ta connexion et réessaie.');
  }
  if (raw) return res;
  if (res.status === 204) return null;
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* corps vide ou non JSON */
  }
  if (!res.ok) {
    // Session expirée ou révoquée : l'application ramène à la connexion (hors pages publiques et routes d'authentification).
    if (res.status === 401 && !share && !path.startsWith('/auth/')) window.dispatchEvent(new CustomEvent('sig:unauthorized'));
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? `Erreur ${res.status}`, e?.details, e?.requestId);
  }
  return data;
}

export const api = {
  get: (path, opts) => request('GET', path, opts),
  post: (path, json, opts) => request('POST', path, { json: json ?? {}, ...opts }),
  patch: (path, json, opts) => request('PATCH', path, { json, ...opts }),
  delete: (path, opts) => request('DELETE', path, opts),
  deleteWith: (path, json) => request('DELETE', path, { json }),
};

/** Charge la session si elle existe. Retourne l'utilisateur ou null. */
export async function loadSession() {
  try {
    const data = await api.get('/auth/me');
    session.set(data);
    return data.user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      session.clear();
      return null;
    }
    throw err;
  }
}

let configPromise;
/** Configuration publique (limites, formats). */
export const getConfig = () => (configPromise ??= api.get('/config').catch((e) => { configPromise = undefined; throw e; }));

/** Message lisible pour l'utilisateur à partir d'une erreur quelconque. */
export function errorMessage(err) {
  if (err instanceof ApiError) {
    if (err.code === 'VALIDATION_ERROR' && err.details?.fields?.length) {
      return err.details.fields.map((f) => `${f.champ} : ${f.message}`).join(' ; ');
    }
    return err.message;
  }
  return 'Une erreur inattendue est survenue.';
}
