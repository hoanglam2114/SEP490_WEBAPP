import { Request, Response, NextFunction } from 'express';
import { validateSession } from '../services/pinSessionManager';

/**
 * Middleware bảo vệ các route /admin/api-keys.
 * Client gửi token qua header: x-pin-token: <token>
 */
export function pinAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers['x-pin-token'] as string | undefined;

  if (!token) {
    res.status(401).json({ error: 'Chưa xác thực. Vui lòng nhập PIN.' });
    return;
  }

  if (!validateSession(token)) {
    res.status(401).json({ error: 'Phiên đã hết hạn hoặc không hợp lệ. Vui lòng nhập lại PIN.' });
    return;
  }

  next();
}
