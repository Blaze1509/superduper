import axios from 'axios';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { Buffer } from 'buffer';

export function getApiBaseUrl() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const origin = window.location.origin;
    if (origin.includes(':8081') || origin.includes(':19006') || origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return 'http://localhost:3001';
    }
    return origin;
  }
  return Constants.expoConfig?.extra?.apiUrl || 'http://localhost:3001';
}

let currentAuthHeader = '';

export function setAuthHeader(authHeader) {
  currentAuthHeader = authHeader;
}

export function buildBasicAuth(username, password) {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

const api = axios.create({
  timeout: 10000,
});

api.interceptors.request.use((config) => {
  config.baseURL = getApiBaseUrl();
  if (currentAuthHeader) {
    config.headers.Authorization = currentAuthHeader;
  }
  return config;
});

export const checkCredentials = async (username, password) => {
  const header = buildBasicAuth(username, password);
  const response = await axios.get(`${getApiBaseUrl()}/api/admin/firms`, {
    headers: { Authorization: header },
    timeout: 10000,
  });
  if (response.data && response.data.success) {
    setAuthHeader(header);
    return header;
  }
  throw new Error('Invalid credentials');
};

export const getFirms = () => api.get('/api/admin/firms');
export const addFirm = (name) => api.post('/api/admin/firms', { name });
export const deleteFirm = (id) => api.delete(`/api/admin/firms/${id}`);
export const generateToken = (firm_id, duration, username = '') => {
  if (typeof duration === 'object' && duration !== null) {
    return api.post('/api/admin/generate-token', { firm_id, username, ...duration });
  }
  return api.post('/api/admin/generate-token', { firm_id, duration_hours: duration, username });
};
export const getTokens = () => api.get('/api/admin/tokens');
export const deactivateFirm = (firm_id) => api.post(`/api/admin/deactivate/${firm_id}`);
export const revokeToken = (id) => api.post(`/api/admin/revoke-token/${id}`);
export const revertToken = (id, duration = 24) => {
  if (typeof duration === 'object' && duration !== null) {
    return api.post(`/api/admin/revert-token/${id}`, { ...duration });
  }
  return api.post(`/api/admin/revert-token/${id}`, { duration_hours: duration });
};
export const deleteToken = (id) => api.delete(`/api/admin/tokens/${id}`);
export const resetTokenPin = (id, newPin, clearPin = false) =>
  api.post(`/api/admin/reset-token-pin/${id}`, { new_pin: newPin, clear_pin: clearPin });

