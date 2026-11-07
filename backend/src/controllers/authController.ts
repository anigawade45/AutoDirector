import { Request, Response, NextFunction } from 'express';
import { UserModel } from '../models/User.js';
import { AppError } from '../middleware/errorHandler.js';

export class AuthController {
  static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, name, tier = 'free' } = req.body;

      if (!email || !name) {
        throw new AppError(400, 'BAD_REQUEST', 'Email and name are required for user registration');
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        throw new AppError(400, 'INVALID_EMAIL', 'Provided email format is invalid');
      }

      const existingUser = await UserModel.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        throw new AppError(409, 'USER_EXISTS', `User with email ${email} already exists`);
      }

      const user = await UserModel.create({
        email: email.toLowerCase(),
        name,
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

      res.status(201).json({
        success: true,
        data: {
          user: {
            id: user._id.toString(),
            email: user.email,
            name: user.name,
            tier: user.tier,
          },
          token: user._id.toString(),
        },
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }

  static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = req.body;

      if (!email) {
        throw new AppError(400, 'BAD_REQUEST', 'Email is required for login');
      }

      const user = await UserModel.findOne({ email: email.toLowerCase() });
      if (!user) {
        throw new AppError(404, 'USER_NOT_FOUND', `No account found for email ${email}`);
      }

      res.status(200).json({
        success: true,
        data: {
          user: {
            id: user._id.toString(),
            email: user.email,
            name: user.name,
            tier: user.tier,
          },
          token: user._id.toString(),
        },
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }
}
