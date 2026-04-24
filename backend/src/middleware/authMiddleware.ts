import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key_please_change_in_production';

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required. No token provided.' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload & {
      userId?: string;
      _id?: string;
      id?: string;
    };

    const userId = decoded.userId || decoded._id || decoded.id;
    if (!userId) {
      res.status(401).json({ error: 'Invalid token payload.' });
      return;
    }

    // Attach normalized user payload so controllers can safely use req.user._id.
    (req as any).user = {
      ...decoded,
      id: String(userId),
      _id: String(userId),
      userId: String(userId),
    };
    
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token.' });
    return;
  }
};
