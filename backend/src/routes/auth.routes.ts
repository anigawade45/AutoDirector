import { Router } from 'express';
import { AuthController } from '../controllers/authController.js';
import { authMiddleware } from '../middleware/auth.js';
import { accountBruteForceLimiter } from '../middleware/rateLimiter.js';

export const authRouter = Router();

authRouter.post('/register', AuthController.register);
authRouter.post('/login', accountBruteForceLimiter, AuthController.login);
authRouter.get('/me', authMiddleware, AuthController.getMe);
