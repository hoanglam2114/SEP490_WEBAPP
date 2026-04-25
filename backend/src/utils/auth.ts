import { Request } from 'express';

export function getAuthUserId(req: Request): string | null {
  const user = (req as any).user;
  const userId = user?._id || user?.userId || user?.id;
  if (!userId) {
    return null;
  }
  const normalized = String(userId);
  // Only return Mongo ObjectId-like ids to avoid cast errors in mongoose filters.
  if (!/^[a-f\d]{24}$/i.test(normalized)) {
    return null;
  }
  return normalized;
}
