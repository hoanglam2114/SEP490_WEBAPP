import { generateToken } from './cryptoService';

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // auto-lock sau 10 phút không thao tác

interface Session {
  lastActivityAt: number;
}

const sessions = new Map<string, Session>();

/** Tạo session mới sau khi xác thực PIN thành công */
export function createSession(): string {
  const token = generateToken();
  sessions.set(token, { lastActivityAt: Date.now() });
  return token;
}

/** Kiểm tra token còn hợp lệ không (và refresh TTL nếu hợp lệ) */
export function validateSession(token: string): boolean {
  const session = sessions.get(token);
  if (!session) return false;

  if (Date.now() - session.lastActivityAt > IDLE_TIMEOUT_MS) {
    sessions.delete(token);
    return false;
  }

  // Refresh TTL
  session.lastActivityAt = Date.now();
  return true;
}

/** Huỷ session (logout) */
export function revokeSession(token: string): void {
  sessions.delete(token);
}

/** Trả về thời gian còn lại (ms) trước khi session expire */
export function getSessionTTL(token: string): number | null {
  const session = sessions.get(token);
  if (!session) return null;
  const remaining = IDLE_TIMEOUT_MS - (Date.now() - session.lastActivityAt);
  return remaining > 0 ? remaining : null;
}

/** Dọn dẹp session hết hạn (gọi định kỳ nếu cần) */
export function cleanExpiredSessions(): void {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (now - session.lastActivityAt > IDLE_TIMEOUT_MS) {
      sessions.delete(token);
    }
  }
}

// Tự dọn mỗi 5 phút
setInterval(cleanExpiredSessions, 5 * 60 * 1000);
