import { Request, Response, NextFunction } from 'express';
import { UserModel } from '../models/User.js';
import { AppError } from '../middleware/errorHandler.js';
import { PasswordService } from '../services/auth/passwordService.js';
import { TokenService } from '../services/auth/tokenService.js';

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
          token: password ? jwtToken : user._id.toString(),
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
      const user = await UserModel.findOne({ email: email.toLowerCase() }).select('+passwordHash +salt');
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
