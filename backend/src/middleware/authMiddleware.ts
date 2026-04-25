import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key_please_change_in_production';

function attachUserFromToken(req: Request, token: string): boolean {
  const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload & {
    userId?: string;
    _id?: string;
    id?: string;
  };

  const userId = decoded.userId || decoded._id || decoded.id;
  if (!userId) {
    return false;
  }

  (req as any).user = {
    ...decoded,
    id: String(userId),
    _id: String(userId),
    userId: String(userId),
  };
  return true;
}

function attachPublicUser(req: Request): void {
  (req as any).user = {
    id: 'public',
    _id: 'public',
    userId: 'public',
    role: 'public',
  };
}

// Strict auth: only for routes that must require login.
export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required. No token provided.' });
      return;
    }

    const token = authHeader.split(' ')[1];
    if (!attachUserFromToken(req, token)) {
      res.status(401).json({ error: 'Invalid token payload.' });
      return;
    }
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token.' });
    return;
  }
};

// Optional auth: if no/invalid token, continue as "public" user.
export const optionalAuthMiddleware = (req: Request, _res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      if (attachUserFromToken(req, token)) {
        return next();
      }
    } catch (error) {
      // Fall through to public user.
    }
  }

  attachPublicUser(req);
  next();
};
