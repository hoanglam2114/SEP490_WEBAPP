import { Request } from 'express';

export function getAuthUserId(req: Request): string | null {
  const user = (req as any).user;
  const userId = user?._id || user?.userId || user?.id;
  if (!userId) {
    return null;
  }
  const normalized = String(userId);
  // Persistence-scoped controllers store ownerId as a Mongo ObjectId.
  // optionalAuthMiddleware uses "public" as a request role marker, not a DB owner.
  if (!/^[a-f\d]{24}$/i.test(normalized)) {
    return null;
  }
  return normalized;
}
