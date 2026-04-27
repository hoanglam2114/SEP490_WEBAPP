import express from 'express';
import { register, login, getMe, listUsers } from '../controllers/authController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', authMiddleware, getMe);
router.get('/users', authMiddleware, listUsers);

export default router;
