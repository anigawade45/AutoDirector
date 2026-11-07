import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler.js';
import { UserModel } from '../models/User.js';
import mongoose from 'mongoose';

declare global {
  namespace Express {
    interface Request {
      user?: {
        _id: mongoose.Types.ObjectId;
        id: string;
        email: string;
        tier: string;
      };
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  // In development and testing, allow default fallback user if no auth header provided
  if (!authHeader && process.env.NODE_ENV !== 'production') {
    let devUser = await UserModel.findOne({ email: 'dev@example.com' });
    if (!devUser) {
      devUser = await UserModel.create({
        email: 'dev@example.com',
        name: 'Developer',
        authProvider: 'local',
        tier: 'pro',
      });
    }

    req.user = {
      _id: devUser._id as mongoose.Types.ObjectId,
      id: devUser._id.toString(),
      email: devUser.email,
      tier: devUser.tier,
    };
    return next();
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication token missing or invalid'));
  }

  const token = authHeader.split(' ')[1];

  try {
    let user = null;
    const cleanToken = token.startsWith('user_') ? token.replace(/^user_/, '') : token;

    if (mongoose.isValidObjectId(cleanToken)) {
      user = await UserModel.findById(cleanToken);
    }

    if (!user) {
      if (token.includes('@')) {
        user = await UserModel.findOne({ email: token });
      } else {
        user = await UserModel.findOne({ email: 'dev@example.com' });
      }
    }

    if (!user) {
      return next(new AppError(401, 'UNAUTHENTICATED', 'User not found for provided token'));
    }

    req.user = {
      _id: user._id as mongoose.Types.ObjectId,
      id: user._id.toString(),
      email: user.email,
      tier: user.tier,
    };

    next();
  } catch (error) {
    next(new AppError(401, 'UNAUTHENTICATED', 'Failed to authenticate bearer token'));
  }
}
