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
  let token: string | undefined = undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query.token && typeof req.query.token === 'string') {
    // Restrict query parameter tokens strictly to Server-Sent Events (SSE)
    // to prevent token exposure in server logs, browser history, and proxy headers for REST routes
    const isSseRequest =
      req.path.endsWith('/events') ||
      req.originalUrl?.includes('/events') ||
      req.headers.accept?.includes('text/event-stream');

    if (!isSseRequest) {
      return next(
        new AppError(
          401,
          'QUERY_TOKEN_FORBIDDEN',
          'Authentication via query parameter is restricted strictly to Server-Sent Events (/events)'
        )
      );
    }
    token = req.query.token;
  }

  if (!token) {
    return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication token missing or invalid'));
  }

  try {
    // Strictly require RFC 7519 cryptographic JWT signature verification.
    // Raw identifiers (ObjectId / email strings) are never accepted as tokens.
    const jwtPayload = TokenService.verifyToken(token);
    if (!jwtPayload) {
      return next(new AppError(401, 'UNAUTHENTICATED', 'Invalid, expired, or malformed JWT token'));
    }

    let user = null;
    if (jwtPayload.sub && mongoose.isValidObjectId(jwtPayload.sub)) {
      user = await UserModel.findById(jwtPayload.sub);
    }
    if (!user && jwtPayload.email && typeof UserModel.findOne === 'function') {
      user = await UserModel.findOne({ email: jwtPayload.email });
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
