import { Request, Response, NextFunction } from 'express';
import { UserModel } from '../models/User.js';
import { AppError } from '../middleware/errorHandler.js';
import { PasswordService } from '../services/auth/passwordService.js';
import { TokenService } from '../services/auth/tokenService.js';
import { env } from '../config/env.js';

export class AuthController {
  static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, name, password, tier = 'free' } = req.body;

      if (!email || !name) {
        throw new AppError(400, 'BAD_REQUEST', 'Email and name are required for user registration');
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        throw new AppError(400, 'INVALID_EMAIL', 'Provided email format is invalid');
      }

      if (password && password.length < 6) {
        throw new AppError(400, 'WEAK_PASSWORD', 'Password must be at least 6 characters');
      }

      const existingUser = await UserModel.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        throw new AppError(409, 'USER_EXISTS', `User with email ${email} already exists`);
      }

      let passwordHash: string | undefined = undefined;
      let salt: string | undefined = undefined;

      if (password) {
        const hashed = PasswordService.hashPassword(password);
        passwordHash = hashed.hash;
        salt = hashed.salt;
      }

      const user = await UserModel.create({
        email: email.toLowerCase(),
        name,
        passwordHash,
        salt,
        tier,
        authProvider: 'local',
        quota: {
          storageBytes:
            tier === 'enterprise'
              ? 100 * 1024 * 1024 * 1024
              : tier === 'pro'
                ? 20 * 1024 * 1024 * 1024
                : 5 * 1024 * 1024 * 1024,
          renderMinutes: tier === 'enterprise' ? 1200 : tier === 'pro' ? 300 : 60,
          promptsPerDay: tier === 'enterprise' ? 1000 : tier === 'pro' ? 500 : 100,
        },
        usage: {
          storageBytesUsed: 0,
          renderMinutesUsed: 0,
          promptsToday: 0,
        },
      });

      const jwtToken = TokenService.generateToken({
        id: user._id.toString(),
        email: user.email,
        tier: user.tier,
        name: user.name,
      });

      // Issue HttpOnly session cookie to mitigate XSS token theft (SEC-010)
      if (typeof res.cookie === 'function') {
        const isProd = env.NODE_ENV === 'production';
        res.cookie('auth_token', jwtToken, {
          httpOnly: true,
          secure: isProd,
          sameSite: 'lax',
          path: '/',
          maxAge: 7 * 24 * 60 * 60 * 1000,
        });
      }

      res.status(201).json({
        success: true,
        data: {
          user: {
            id: user._id.toString(),
            email: user.email,
            name: user.name,
            tier: user.tier,
            quota: user.quota,
            usage: user.usage,
          },
          token: jwtToken,
          jwt: jwtToken,
        },
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }

  static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body;

      if (!email) {
        throw new AppError(400, 'BAD_REQUEST', 'Email is required for login');
      }

      // Explicitly select passwordHash and salt which are select: false by default
      const user = await UserModel.findOne({ email: email.toLowerCase() }).select(
        '+passwordHash +salt'
      );
      if (!user) {
        throw new AppError(404, 'USER_NOT_FOUND', `No account found for email ${email}`);
      }

      if (user.passwordHash && user.salt) {
        if (!password) {
          throw new AppError(400, 'BAD_REQUEST', 'Password is required to log into this account');
        }
        const isValid = PasswordService.verifyPassword(password, user.salt, user.passwordHash);
        if (!isValid) {
          throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect password provided');
        }
      }

      const jwtToken = TokenService.generateToken({
        id: user._id.toString(),
        email: user.email,
        tier: user.tier,
        name: user.name,
      });

      // Issue HttpOnly session cookie to mitigate XSS token theft (SEC-010)
      if (typeof res.cookie === 'function') {
        const isProd = env.NODE_ENV === 'production';
        res.cookie('auth_token', jwtToken, {
          httpOnly: true,
          secure: isProd,
          sameSite: 'lax',
          path: '/',
          maxAge: 7 * 24 * 60 * 60 * 1000,
        });
      }

      res.status(200).json({
        success: true,
        data: {
          user: {
            id: user._id.toString(),
            email: user.email,
            name: user.name,
            tier: user.tier,
            quota: user.quota,
            usage: user.usage,
          },
          token: jwtToken,
          jwt: jwtToken,
        },
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }

  static async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (typeof res.clearCookie === 'function') {
        const isProd = env.NODE_ENV === 'production';
        res.clearCookie('auth_token', {
          httpOnly: true,
          secure: isProd,
          sameSite: 'lax',
          path: '/',
        });
      }

      res.status(200).json({
        success: true,
        data: {
          message: 'Signed out successfully and cleared session cookie',
        },
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }

  static async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const authHeader = req.headers.authorization;
      let token: string | undefined = undefined;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
      } else if (
        req.headers.cookie &&
        (req.headers.cookie.includes('auth_token=') || req.headers.cookie.includes('token='))
      ) {
        const cookiePairs = req.headers.cookie.split(';').map((c) => c.trim().split('='));
        for (const [k, ...v] of cookiePairs) {
          if ((k === 'auth_token' || k === 'token') && v.length > 0) {
            token = decodeURIComponent(v.join('='));
            break;
          }
        }
      }

      if (!token) {
        throw new AppError(401, 'UNAUTHENTICATED', 'No active token provided for refresh');
      }

      const payload = TokenService.verifyToken(token);
      if (!payload) {
        throw new AppError(401, 'UNAUTHENTICATED', 'Token expired or invalid');
      }

      const user = await UserModel.findById(payload.sub);
      if (!user) {
        throw new AppError(404, 'USER_NOT_FOUND', 'User profile not found');
      }

      const rotatedToken = TokenService.rotateToken(token);
      if (!rotatedToken) {
        throw new AppError(401, 'UNAUTHENTICATED', 'Failed to rotate token');
      }

      if (typeof res.cookie === 'function') {
        const isProd = env.NODE_ENV === 'production';
        res.cookie('auth_token', rotatedToken, {
          httpOnly: true,
          secure: isProd,
          sameSite: 'lax',
          path: '/',
          maxAge: 7 * 24 * 60 * 60 * 1000,
        });
      }

      res.status(200).json({
        success: true,
        data: {
          token: rotatedToken,
          jwt: rotatedToken,
          user: {
            id: user._id.toString(),
            email: user.email,
            name: user.name,
            tier: user.tier,
            quota: user.quota,
            usage: user.usage,
          },
        },
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }

  static async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHENTICATED', 'User not authenticated');
      }

      const user = await UserModel.findById(req.user.id);
      if (!user) {
        throw new AppError(404, 'USER_NOT_FOUND', 'User profile not found');
      }

      res.status(200).json({
        success: true,
        data: {
          user: {
            id: user._id.toString(),
            email: user.email,
            name: user.name,
            tier: user.tier,
            quota: user.quota,
            usage: user.usage,
          },
        },
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }
}
