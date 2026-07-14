import axios from 'axios';
import { toast } from 'react-toastify';
import { store } from '../app/store';
import { logout, setTokens } from '../features/auth/authSlice';

const baseURL = import.meta.env.VITE_API_URL || '/api/v1';

const api = axios.create({ baseURL, withCredentials: false });

// ------------------------------------------------------------------
// JWT expiry preflight.
//
// Decode the persisted access token WITHOUT verifying (that's the server's
// job) purely to check its `exp` claim. When the token is already past
// its expiry, firing 10+ parallel dashboard/settings/attendance requests
// on page-load produces 10+ visible red 401s in devtools before the
// response interceptor's refresh queue catches up — the network entries
// have already been logged. Preflighting the refresh here means every
// request goes out with a fresh token and no 401 is ever produced for
// the common "reload the tab after the token expired" case.
// ------------------------------------------------------------------
const decodeJwtExp = (token) => {
  if (!token || typeof token !== 'string') return 0;
  const parts = token.split('.');
  if (parts.length !== 3) return 0;
  try {
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
    );
    return Number(payload?.exp) || 0;
  } catch { return 0; }
};

const isAccessExpired = (token) => {
  const exp = decodeJwtExp(token);
  if (!exp) return false; // opaque or unparseable — let the server decide
  // 5 s skew so a token that expires "right now" is treated as expired.
  return Date.now() / 1000 >= exp - 5;
};

api.interceptors.request.use(async (config) => {
  const state = store.getState().auth;
  let token = state.accessToken;
  const authEndpoint = isAuthEndpointUrl(config.url || '');
  // Only preflight for protected endpoints — never for /auth/login,
  // /auth/refresh, etc. (those don't need Authorization at all and would
  // deadlock on the refresh path).
  if (!authEndpoint && token && isAccessExpired(token) && state.refreshToken) {
    try {
      // Reuse the in-flight refresh if the response interceptor already
      // kicked one off; otherwise start a new one. The response
      // interceptor's `finally` block (below) is the sole owner of
      // clearing `refreshPromise`, so DO NOT reset it here — that would
      // let a concurrent 401 trigger a second refresh mid-flight.
      if (!refreshPromise) refreshPromise = runRefresh().finally(() => {
        refreshPromise = null;
      });
      token = await refreshPromise;
    } catch {
      // Refresh failed — fall through with the stale token so the
      // response interceptor sees the 401 and dispatches logout via the
      // existing single-flight path (which also fires the toast).
    }
  }
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ------------------------------------------------------------------
// Single-flight refresh queue.
//
// Only ONE /auth/refresh request may be in flight at any time. Every
// request that fails with 401 while a refresh is running is parked in
// `pendingQueue` and replayed with the new access token as soon as the
// refresh resolves. If the refresh REJECTS, every queued request is
// rejected too, the auth state is cleared, and the user is redirected
// to the login screen by ProtectedRoute.
//
// This eliminates the burst of parallel 401 → refresh → retry loops that
// used to fire one toast per parallel request when the token expired.
// ------------------------------------------------------------------
let refreshPromise = null;
let pendingQueue = [];

const enqueue = () =>
  new Promise((resolve, reject) => { pendingQueue.push({ resolve, reject }); });

const flushQueue = (error, token = null) => {
  const q = pendingQueue;
  pendingQueue = [];
  for (const { resolve, reject } of q) {
    if (error) reject(error);
    else resolve(token);
  }
};

const isAuthEndpointUrl = (url = '') =>
  /\/auth\/(login|refresh|forgot-password|reset-password)/.test(url);

/**
 * Perform the refresh HTTP call exactly once for a burst of 401s.
 * Uses a bare axios instance so we never re-enter our own interceptor
 * and never accidentally attach the (about to be replaced) access token.
 */
const runRefresh = async () => {
  const refreshToken = store.getState().auth.refreshToken;
  if (!refreshToken) throw new Error('missing refresh token');
  const { data } = await axios.post(
    `${baseURL}/auth/refresh`,
    { refreshToken },
    { headers: { 'Content-Type': 'application/json' } }
  );
  const accessToken = data?.data?.accessToken;
  const newRefresh = data?.data?.refreshToken;
  if (!accessToken) throw new Error('refresh returned no access token');
  store.dispatch(setTokens({ accessToken, refreshToken: newRefresh || refreshToken }));
  return accessToken;
};

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error?.config;
    const status = error?.response?.status;
    const url = original?.url || '';
    const authEndpoint = isAuthEndpointUrl(url);

    // Only attempt refresh for genuine 401 → protected endpoint failures
    // that we haven't already replayed once.
    const shouldRefresh =
      status === 401 &&
      original &&
      !original._retry &&
      !authEndpoint;

    if (shouldRefresh) {
      // No refresh token → straight logout. Suppress the toast so the
      // login redirect isn't accompanied by a red banner mid-navigation.
      const refreshToken = store.getState().auth.refreshToken;
      if (!refreshToken) {
        store.dispatch(logout());
        return Promise.reject(error);
      }

      // Mark this request as a retry BEFORE queueing, so if it comes back
      // as 401 again we don't loop into another refresh cycle.
      original._retry = true;

      // If a refresh is already running, park this request and replay it
      // when the shared promise resolves. This is the whole point of the
      // pattern — N concurrent 401s produce exactly ONE /refresh call.
      if (refreshPromise) {
        try {
          const token = await enqueue();
          original.headers = original.headers || {};
          original.headers.Authorization = `Bearer ${token}`;
          return api(original);
        } catch (e) {
          return Promise.reject(e);
        }
      }

      // First 401 in the burst — kick off the refresh, and let subsequent
      // 401s (which will see refreshPromise set) enqueue.
      refreshPromise = runRefresh();
      try {
        const token = await refreshPromise;
        flushQueue(null, token);
        original.headers = original.headers || {};
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      } catch (e) {
        // Refresh itself failed — reject every queued request with the
        // same error so ONE toast fires (below, on the rejection path).
        flushQueue(e, null);
        store.dispatch(logout());
        toast.error('Session expired, please log in again');
        return Promise.reject(e);
      } finally {
        refreshPromise = null;
      }
    }

    // ----------------------------------------------------------------
    // Error toast policy.
    //
    // Suppress toasts for:
    //  - 401s while a refresh is in flight (they'll be replayed).
    //  - The retried request's own eventual 401 (marked with _retry).
    //  - Requests that opt out via `config.silent`.
    //  - The /auth/refresh call itself (its outcome is toasted above).
    // ----------------------------------------------------------------
    const suppress =
      original?.silent ||
      authEndpoint ||
      (status === 401 && (refreshPromise || original?._retry));
    if (!suppress && status && status >= 400) {
      const msg = error?.response?.data?.message || error.message;
      if (msg) toast.error(msg);
    }
    return Promise.reject(error);
  }
);

export default api;
