import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const adminApi = axios.create({ baseURL: API_BASE_URL });

// Tự động đính token vào mọi request
adminApi.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('pin_token');
  if (token) config.headers['x-pin-token'] = token;
  return config;
});

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PinStatus {
  initialized: boolean;
  isLocked: boolean;
  remainingSeconds: number;
  lockedUntil: string | null;
  failCount: number;
  isUnlocked: boolean;
}

export interface ApiKey {
  name: string;
  maskedValue: string;
  description: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

export interface ImportItem {
  name: string;
  value: string;
  alreadyExists: boolean;
}

export interface ParseImportResult {
  count: number;
  items: ImportItem[];
}

export interface AuditLogEntry {
  _id: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'TOGGLE' | 'IMPORT';
  keyName: string;
  detail: string;
  createdAt: string;
}

// ─── PIN ─────────────────────────────────────────────────────────────────────

export const pinApi = {
  getStatus: () =>
    adminApi.get<PinStatus>('/admin/pin/status').then((r) => r.data),

  setup: (pin: string) =>
    adminApi.post<{ message: string }>('/admin/pin/setup', { pin }).then((r) => r.data),

  verify: (pin: string) =>
    adminApi.post<{ token: string; message: string }>('/admin/pin/verify', { pin }).then((r) => r.data),

  logout: () =>
    adminApi.post('/admin/pin/logout').then((r) => r.data),

  change: (currentPin: string, newPin: string) =>
    adminApi.post('/admin/pin/change', { currentPin, newPin }).then((r) => r.data),
};

// ─── API Keys ─────────────────────────────────────────────────────────────────

export const keyApi = {
  list: () =>
    adminApi.get<ApiKey[]>('/admin/api-keys').then((r) => r.data),

  create: (name: string, value: string, description?: string) =>
    adminApi.post<{ message: string; isNew: boolean }>('/admin/api-keys', { name, value, description }).then((r) => r.data),

  delete: (name: string) =>
    adminApi.delete<{ message: string }>(`/admin/api-keys/${name}`).then((r) => r.data),

  toggle: (name: string) =>
    adminApi.patch<{ message: string; isActive: boolean }>(`/admin/api-keys/${name}/toggle`).then((r) => r.data),

  updateDescription: (name: string, description: string) =>
    adminApi.patch<{ message: string }>(`/admin/api-keys/${name}/description`, { description }).then((r) => r.data),

  parseImport: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return adminApi.post<ParseImportResult>('/admin/api-keys/import/parse', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },

  getAuditLog: (limit = 100) =>
    adminApi.get<AuditLogEntry[]>(`/admin/api-keys/audit-log?limit=${limit}`).then((r) => r.data),
};
