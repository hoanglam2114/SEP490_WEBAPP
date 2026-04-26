import { ApiKeyConfig } from '../models/ApiKeyConfig';
import { ApiKeyAuditLog, AuditAction } from '../models/ApiKeyAuditLog';
import { encrypt, decrypt, EncryptedPayload } from './cryptoService';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 phút

interface CacheEntry {
  value: string;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

// ─── Read ───────────────────────────────────────────────────────────────────

/** Lấy giá trị key đã giải mã (có cache) */
export async function getKey(name: string): Promise<string> {
  const upper = name.toUpperCase();
  const cached = cache.get(upper);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.value;
  }

  const record = await ApiKeyConfig.findOne({ name: upper, isActive: true });
  if (!record) throw new Error(`API key "${upper}" không tồn tại hoặc đã bị vô hiệu`);

  const value = decrypt({
    encryptedValue: record.encryptedValue,
    iv: record.iv,
    authTag: record.authTag,
  });

  cache.set(upper, { value, fetchedAt: Date.now() });
  ApiKeyConfig.updateOne({ name: upper }, { lastUsedAt: new Date() }).exec();

  return value;
}

/** Lấy tất cả keys (không giải mã — dùng cho UI listing) */
export async function listKeys() {
  return ApiKeyConfig.find({}, '-encryptedValue -iv -authTag').sort({ name: 1 });
}

// ─── Write ──────────────────────────────────────────────────────────────────

/** Thêm hoặc cập nhật key */
export async function setKey(
  name: string,
  plainValue: string,
  description?: string
): Promise<{ isNew: boolean }> {
  const upper = name.toUpperCase();
  const payload: EncryptedPayload = encrypt(plainValue);

  const existing = await ApiKeyConfig.findOne({ name: upper });
  const action: AuditAction = existing ? 'UPDATE' : 'CREATE';

  await ApiKeyConfig.findOneAndUpdate(
    { name: upper },
    { ...payload, ...(description !== undefined && { description }) },
    { upsert: true, new: true }
  );

  cache.delete(upper);
  await log(action, upper, existing ? 'Cập nhật giá trị' : 'Tạo mới');

  return { isNew: !existing };
}

/** Xoá key */
export async function deleteKey(name: string): Promise<void> {
  const upper = name.toUpperCase();
  await ApiKeyConfig.deleteOne({ name: upper });
  cache.delete(upper);
  await log('DELETE', upper);
}

/** Toggle active/inactive */
export async function toggleKey(name: string): Promise<boolean> {
  const upper = name.toUpperCase();
  const record = await ApiKeyConfig.findOne({ name: upper });
  if (!record) throw new Error(`API key "${upper}" không tồn tại`);

  const newStatus = !record.isActive;
  await ApiKeyConfig.updateOne({ name: upper }, { isActive: newStatus });
  cache.delete(upper);
  await log('TOGGLE', upper, `isActive: ${record.isActive} → ${newStatus}`);

  return newStatus;
}

/** Xoá toàn bộ cache (dùng khi cần force-reload) */
export function clearCache(name?: string) {
  if (name) cache.delete(name.toUpperCase());
  else cache.clear();
}

// ─── Audit ──────────────────────────────────────────────────────────────────

async function log(action: AuditAction, keyName: string, detail?: string) {
  await ApiKeyAuditLog.create({ action, keyName, detail });
}

export async function getAuditLog(limit = 100) {
  return ApiKeyAuditLog.find().sort({ createdAt: -1 }).limit(limit);
}
