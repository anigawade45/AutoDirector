import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler.js';
import { UserModel } from '../models/User.js';
import { TokenService } from '../services/auth/tokenService.js';
import { StructuredLogger } from '../services/observability/logger.js';
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
  } else if (req.headers.cookie && (req.headers.cookie.includes('auth_token=') || req.headers.cookie.includes('token='))) {
    // Cookie-authenticated session support (e.g. browser EventSource or credentialed requests)
    // Eliminates token transmission in URL query strings and proxy access logs
    const cookiePairs = req.headers.cookie.split(';').map((c) => c.trim().split('='));
    for (const [k, ...v] of cookiePairs) {
      if ((k === 'auth_token' || k === 'token') && v.length > 0) {
        token = decodeURIComponent(v.join('='));
        break;
      }
    }
  } else if (req.query.ticket && typeof req.query.ticket === 'string') {
    // Ephemeral single-use SSE ticket authentication (valid for 30s, immediately consumed)
    // Prevents persistent auth token leakage in proxy logs, referrer headers, and browser history
    const isSseRequest =
      req.path.endsWith('/events') ||
      req.originalUrl?.includes('/events') ||
      req.headers.accept?.includes('text/event-stream');

    if (!isSseRequest) {
      return next(
        new AppError(
          401,
          'QUERY_TICKET_FORBIDDEN',
          'Authentication via ticket query parameter is restricted strictly to Server-Sent Events (/events)'
        )
      );
    }

    const ticketPayload = await TokenService.consumeSseTicket(req.query.ticket);
    if (!ticketPayload) {
      return next(
        new AppError(
          401,
          'INVALID_OR_EXPIRED_TICKET',
          'The provided single-use SSE ticket is invalid, expired, or has already been consumed'
        )
      );
    }

    // Verify ticket scope if ticket is restricted to a specific job
    const pathMatch = (req.path || '').match(/\/([^/?#]+)\/events/);
    const requestedJobId = pathMatch
      ? pathMatch[1].replace(/^job_/, '')
      : (req.params?.id || '').replace(/^job_/, '');

    if (ticketPayload.jobId && requestedJobId && ticketPayload.jobId !== requestedJobId) {
      return next(
        new AppError(
          403,
          'TICKET_SCOPE_MISMATCH',
          'This single-use SSE ticket is not authorized for the requested job'
        )
      );
    }

    let user = null;
    if (ticketPayload.userId && mongoose.isValidObjectId(ticketPayload.userId)) {
      user = await UserModel.findById(ticketPayload.userId);
    }

    if (!user) {
      return next(new AppError(401, 'UNAUTHENTICATED', 'User not found for provided ticket'));
    }

    req.user = {
      _id: (user._id || user.id) as mongoose.Types.ObjectId,
      id: (user._id || user.id).toString(),
      email: user.email,
      tier: user.tier,
    };

    return next();
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

    StructuredLogger.warn(
      '[DEPRECATION] Authentication via ?token= query parameter is deprecated to prevent credential exposure in access and proxy logs. Use Authorization: Bearer header with streaming fetch or single-use ?ticket= instead.',
      { path: req.path }
    );

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
