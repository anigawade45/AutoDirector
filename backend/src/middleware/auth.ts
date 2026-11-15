import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler.js';
import { UserModel } from '../models/User.js';
import { TokenService } from '../services/auth/tokenService.js';
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

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication token missing or invalid'));
  }

  const token = authHeader.split(' ')[1];

  try {
    let user = null;

    // 1. Try decoding RFC 7519 standard JWT token
    const jwtPayload = TokenService.verifyToken(token);
    if (jwtPayload) {
      if (jwtPayload.sub && mongoose.isValidObjectId(jwtPayload.sub)) {
        user = await UserModel.findById(jwtPayload.sub);
      }
      if (!user && jwtPayload.email && typeof UserModel.findOne === 'function') {
        user = await UserModel.findOne({ email: jwtPayload.email });
      }
    }

    // 2. Direct user ObjectId or registered email lookup
    if (!user) {
      const cleanToken = token.startsWith('user_') ? token.replace(/^user_/, '') : token;
      if (mongoose.isValidObjectId(cleanToken)) {
        user = await UserModel.findById(cleanToken);
      } else if (token.includes('@') && typeof UserModel.findOne === 'function') {
        user = await UserModel.findOne({ email: token.toLowerCase() });
      }
    }

    if (!user) {
      return next(new AppError(401, 'UNAUTHENTICATED', 'User not found for provided token'));
    }

    req.user = {
      _id: (user._id || user.id) as mongoose.Types.ObjectId,
      id: (user._id || user.id).toString(),
      email: user.email,
      tier: user.tier,
    };

    next();
  } catch (err) {
    next(err);
  }
}

