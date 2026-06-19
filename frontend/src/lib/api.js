import axios from 'axios';
import { toast } from 'react-toastify';
import { store } from '../app/store';
import { logout, setTokens } from '../features/auth/authSlice';

const baseURL = import.meta.env.VITE_API_URL || '/api/v1';

const api = axios.create({ baseURL, withCredentials: false });

api.interceptors.request.use((config) => {
  const token = store.getState().auth.accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let isRefreshing = false;
let queue = [];

const processQueue = (error, token = null) => {
  queue.forEach(({ resolve, reject }) => (error ? reject(error) : resolve(token)));
  queue = [];
};

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const status = error?.response?.status;
    const url = original?.url || '';
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/refresh') || url.includes('/auth/forgot-password') || url.includes('/auth/reset-password');

    if (status === 401 && !original._retry && !isAuthEndpoint) {
      const refreshToken = store.getState().auth.refreshToken;
      if (!refreshToken) {
        store.dispatch(logout());
        return Promise.reject(error);
      }
      if (isRefreshing) {
        return new Promise((resolve, reject) => queue.push({ resolve, reject }))
          .then((token) => {
            original.headers.Authorization = `Bearer ${token}`;
            return api(original);
          })
          .catch((e) => Promise.reject(e));
      }
      original._retry = true;
      isRefreshing = true;
      try {
        const { data } = await axios.post(`${baseURL}/auth/refresh`, { refreshToken });
        const { accessToken, refreshToken: newRefresh } = data.data;
        store.dispatch(setTokens({ accessToken, refreshToken: newRefresh }));
        processQueue(null, accessToken);
        original.headers.Authorization = `Bearer ${accessToken}`;
        return api(original);
      } catch (e) {
        processQueue(e, null);
        store.dispatch(logout());
        toast.error('Session expired, please log in again');
        return Promise.reject(e);
      } finally {
        isRefreshing = false;
      }
    }
    const msg = error?.response?.data?.message || error.message;
    if (status && status >= 400 && !original?.silent) toast.error(msg);
    return Promise.reject(error);
  }
);

export default api;
