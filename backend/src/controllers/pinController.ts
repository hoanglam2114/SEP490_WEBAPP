import { Request, Response } from 'express';
import { PinConfig } from '../models/PinConfig';
import { hashPin, verifyPin } from '../services/cryptoService';
import { createSession, revokeSession, validateSession } from '../services/pinSessionManager';

/**
 * Logic khoá:
 *  - failCount 1–4 : cảnh báo, còn X lần
 *  - failCount = 5 : khoá 30 giây
 *  - failCount 6–9 : cảnh báo sau khi mở khoá
 *  - failCount >= 10: khoá 5 phút
 */
const LOCK_AFTER_FIRST  = 5;    // khoá lần 1 sau bao nhiêu lần sai
const LOCK_AFTER_TOTAL  = 10;   // khoá lần 2 (dài hơn) sau bao nhiêu lần sai
const LOCK_DURATION_1   = 30;   // giây
const LOCK_DURATION_2   = 300;  // giây (5 phút)
const MAX_ATTEMPTS      = 10;   // tổng tối đa trước khoá dài

// ─── Setup PIN lần đầu ───────────────────────────────────────────────────────

/**
 * POST /api/admin/pin/setup
 * Body: { pin: "123456" }
 * Chỉ hoạt động nếu chưa có PIN nào được thiết lập.
 */
export async function setupPin(req: Request, res: Response): Promise<void> {
  try {
    const existing = await PinConfig.findOne();
    if (existing) {
      res.status(409).json({ error: 'PIN đã được thiết lập. Dùng /change để đổi.' });
      return;
    }

    const { pin } = req.body;
    if (!pin || !/^\d{6}$/.test(pin)) {
      res.status(400).json({ error: 'PIN phải là 6 chữ số.' });
      return;
    }

    const { hash, salt } = await hashPin(pin);
    await PinConfig.create({ pinHash: hash, pinSalt: salt });

    res.json({ message: 'PIN đã được thiết lập thành công.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

// ─── Xác thực PIN ────────────────────────────────────────────────────────────

/**
 * POST /api/admin/pin/verify
 * Body: { pin: "123456" }
 * Response: { token: "..." } hoặc lỗi
 */
export async function verifyPinHandler(req: Request, res: Response): Promise<void> {
  try {
    const config = await PinConfig.findOne();
    if (!config) {
      res.status(404).json({ error: 'Chưa thiết lập PIN. Gọi /setup trước.' });
      return;
    }

    // Kiểm tra có đang bị khoá không
    if (config.lockedUntil && config.lockedUntil > new Date()) {
      const remainingMs = config.lockedUntil.getTime() - Date.now();
      const remainingSec = Math.ceil(remainingMs / 1000);
      res.status(429).json({
        error: `Tài khoản đang bị khoá. Vui lòng thử lại sau ${remainingSec} giây.`,
        lockedUntil: config.lockedUntil,
        remainingSeconds: remainingSec,
      });
      return;
    }

    const { pin } = req.body;
    if (!pin || !/^\d{6}$/.test(pin)) {
      res.status(400).json({ error: 'PIN phải là 6 chữ số.' });
      return;
    }

    const isCorrect = await verifyPin(pin, config.pinHash, config.pinSalt);

    if (!isCorrect) {
      const newFailCount = config.failCount + 1;
      let lockedUntil: Date | null = null;
      let lockDuration = 0;

      if (newFailCount >= LOCK_AFTER_TOTAL) {
        lockDuration = LOCK_DURATION_2;
        lockedUntil = new Date(Date.now() + lockDuration * 1000);
      } else if (newFailCount >= LOCK_AFTER_FIRST) {
        lockDuration = LOCK_DURATION_1;
        lockedUntil = new Date(Date.now() + lockDuration * 1000);
      }

      await PinConfig.updateOne({}, { failCount: newFailCount, lockedUntil });

      const remainingAttempts = Math.max(0, MAX_ATTEMPTS - newFailCount);

      if (lockedUntil) {
        res.status(429).json({
          error: `PIN sai. Tài khoản bị khoá ${lockDuration} giây.`,
          lockedUntil,
          remainingSeconds: lockDuration,
          failCount: newFailCount,
        });
      } else {
        res.status(401).json({
          error: `PIN không đúng.`,
          remainingAttempts,
          failCount: newFailCount,
        });
      }
      return;
    }

    // PIN đúng → reset failCount, tạo session
    await PinConfig.updateOne({}, { failCount: 0, lockedUntil: null });
    const token = createSession();

    res.json({ token, message: 'Xác thực thành công.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

// ─── Đổi PIN ─────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/pin/change
 * Header: x-pin-token
 * Body: { currentPin: "123456", newPin: "654321" }
 */
export async function changePin(req: Request, res: Response): Promise<void> {
  try {
    const config = await PinConfig.findOne();
    if (!config) {
      res.status(404).json({ error: 'Chưa thiết lập PIN.' });
      return;
    }

    const { currentPin, newPin } = req.body;
    if (!currentPin || !newPin || !/^\d{6}$/.test(newPin)) {
      res.status(400).json({ error: 'PIN mới phải là 6 chữ số.' });
      return;
    }

    const isCorrect = await verifyPin(currentPin, config.pinHash, config.pinSalt);
    if (!isCorrect) {
      res.status(401).json({ error: 'PIN hiện tại không đúng.' });
      return;
    }

    const { hash, salt } = await hashPin(newPin);
    await PinConfig.updateOne({}, { pinHash: hash, pinSalt: salt, failCount: 0, lockedUntil: null });

    res.json({ message: 'Đổi PIN thành công.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

// ─── Logout ──────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/pin/logout
 * Header: x-pin-token
 */
export async function logoutPin(req: Request, res: Response): Promise<void> {
  const token = req.headers['x-pin-token'] as string;
  if (token) revokeSession(token);
  res.json({ message: 'Đã đăng xuất.' });
}

// ─── Trạng thái khoá (cho UI kiểm tra trước khi vào màn hình) ────────────────

/**
 * GET /api/admin/pin/status
 */
export async function getPinStatus(req: Request, res: Response): Promise<void> {
  try {
    const config = await PinConfig.findOne();
    if (!config) {
      res.json({ initialized: false });
      return;
    }

    const isLocked = !!config.lockedUntil && config.lockedUntil > new Date();
    const remainingSec = isLocked
      ? Math.ceil((config.lockedUntil!.getTime() - Date.now()) / 1000)
      : 0;

    // Kiểm tra session token hiện tại (nếu có)
    const token = req.headers['x-pin-token'] as string | undefined;
    const isUnlocked = token ? validateSession(token) : false;

    res.json({
      initialized: true,
      isLocked,
      remainingSeconds: remainingSec,
      lockedUntil: isLocked ? config.lockedUntil : null,
      failCount: config.failCount,
      isUnlocked,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
