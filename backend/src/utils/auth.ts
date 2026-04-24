import { Request } from 'express';

export function getAuthUserId(req: Request): string | null {
  const user = (req as any).user;
  const userId = user?._id || user?.userId || user?.id;
  if (!userId) {
    return null;
  }
  return String(userId);
}
