import axios from 'axios';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { Buffer } from 'buffer';
import CryptoJS from 'crypto-js';

const SHARED_SECRET = 'HACKER_PROOF_ENCRYPTION_KEY_2026';

export function getApiBaseUrl() {
  if (__DEV__) {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      return `http://${window.location.hostname}:3001`;
    }
    const hostUri = Constants.expoConfig?.hostUri || Constants.manifest2?.extra?.expoGo?.developer?.tool;
    if (hostUri) {
      const ip = hostUri.split(':')[0];
      if (ip && ip !== 'localhost' && ip !== '127.0.0.1') return `http://${ip}:3001`;
    }
    return 'http://192.168.1.100:3001';
  }
  return 'https://hackbackend-production.up.railway.app';
}

let currentAuthHeader = '';

export function setAuthHeader(authHeader) {
  currentAuthHeader = authHeader;
}

export function buildBasicAuth(username, password) {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

export const api = axios.create({
  baseURL: getApiBaseUrl(),
});

// Admin Request Interceptor (Encrypt)
api.interceptors.request.use((config) => {
  if (currentAuthHeader) {
    config.headers['Authorization'] = currentAuthHeader;
  }
  // Phase 4: Encrypt the Payload
  if (config.data && Object.keys(config.data).length > 0) {
    const jsonStr = JSON.stringify(config.data);
    const encrypted = CryptoJS.AES.encrypt(jsonStr, SHARED_SECRET).toString();
    config.data = { encryptedPayload: encrypted };
  }
  return config;
});

// Admin Response Interceptor (Decrypt)
api.interceptors.response.use((response) => {
  if (response.data && response.data.encryptedPayload) {
    try {
      const bytes = CryptoJS.AES.decrypt(response.data.encryptedPayload, SHARED_SECRET);
      const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
      response.data = JSON.parse(decryptedStr);
    } catch (e) {
      console.error('Failed to decrypt response payload from server');
    }
  }
  return response;
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
export const resetPanic = (id) => api.post('/api/admin/panic/reset', { token_id: id });


