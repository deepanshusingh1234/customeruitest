import axios from 'axios';

/** Match backend `app` mount (default: local Express on port 5000). */
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api').replace(/\/$/, '');

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

/** Refresh uses a separate client so response interceptors do not recurse. */
const refreshClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

let onSessionRefreshed = null;

/** AuthContext registers this to sync React state when tokens rotate. */
export function registerSessionRefreshed(handler) {
  onSessionRefreshed = handler;
}

function applyRefreshResponse(res) {
  const { customer, accessToken } = res.data || {};
  if (accessToken) {
    localStorage.setItem('accessToken', accessToken);
  }
  if (customer) {
    localStorage.setItem('user', JSON.stringify(customer));
  }
  if (onSessionRefreshed) {
    onSessionRefreshed({ customer, accessToken });
  }
}

/** Single in-flight refresh — concurrent 401s share one POST /customer/auth/refresh. */
let sharedRefreshPromise = null;

export function runSharedRefresh() {
  if (!sharedRefreshPromise) {
    sharedRefreshPromise = refreshClient
      .post('/customer/auth/refresh')
      .then((res) => {
        applyRefreshResponse(res);
        return res;
      })
      .finally(() => {
        sharedRefreshPromise = null;
      });
  }
  return sharedRefreshPromise;
}

export function clearAuthStorage() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('user');
  delete api.defaults.headers.common.Authorization;
}

const isLoginPath = () => {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  return path === '/login';
};

const isPublicAuthRequest = (url) =>
  url.includes('/customer/auth/login') ||
  url.includes('/customer/auth/register') ||
  url.includes('/customer/auth/refresh');

export function forceLogoutAndRedirect() {
  clearAuthStorage();
  if (onSessionRefreshed) {
    onSessionRefreshed({ customer: null, accessToken: null });
  }
  if (!isLoginPath()) {
    window.location.href = '/login';
  }
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const originalRequest = error.config;
    const status = error.response?.status;
    const requestUrl = String(originalRequest?.url || '');

    if (status !== 401 || !originalRequest) {
      return Promise.reject(error);
    }

    if (isPublicAuthRequest(requestUrl)) {
      return Promise.reject(error);
    }

    if (originalRequest._retry) {
      forceLogoutAndRedirect();
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      await runSharedRefresh();
      const token = localStorage.getItem('accessToken');
      if (token) {
        originalRequest.headers = originalRequest.headers ?? {};
        originalRequest.headers.Authorization = `Bearer ${token}`;
      }
      return api(originalRequest);
    } catch (refreshError) {
      forceLogoutAndRedirect();
      return Promise.reject(refreshError);
    }
  },
);

export default api;
