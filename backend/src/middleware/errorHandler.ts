import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  public statusCode: number;
  public code: string;
  public details?: Array<{ field?: string; issue: string }>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Array<{ field?: string; issue: string }>
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction): void {
  const requestId = req.id || 'unknown_req';

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request payload validation failed',
        details: err.errors.map((e) => ({
          field: e.path.join('.'),
          issue: e.message,
        })),
      },
      requestId,
    });
    return;
  }

  // Handle MongoDB duplicate key errors (code 11000) with collection & field-specific mappings
  if (err.code === 11000 || (err.name === 'MongoServerError' && err.code === 11000)) {
    const keyPattern = err.keyPattern || {};
    const fields = Object.keys(keyPattern);
    const collectionMatch =
      typeof err.message === 'string' ? err.message.match(/collection:\s+[^.]+\.(\w+)/i) : null;
    const collectionName = (
      err.collectionName ||
      err.collection?.name ||
      collectionMatch?.[1] ||
      ''
    ).toLowerCase();

    let code = 'RESOURCE_CONFLICT';
    let message = 'A resource with duplicate unique properties already exists.';

    if (collectionName === 'users' || fields.includes('email')) {
      code = 'USER_EXISTS';
      message = 'An account with this email already exists. Please sign in instead.';
    } else if (
      collectionName === 'editplans' ||
      collectionName === 'timelines' ||
      collectionName === 'timelineversions' ||
      fields.includes('version')
    ) {
      code = 'VERSION_CONFLICT';
      message = 'A version conflict occurred for this project. Please refresh your timeline.';
    } else if (collectionName === 'assets' || fields.includes('assetId')) {
      code = 'ASSET_EXISTS';
      message = 'An asset with this identifier already exists.';
    } else if (collectionName === 'projects' || fields.includes('publicId')) {
      code = 'PROJECT_CONFLICT';
      message = 'A project with this identifier already exists.';
    } else if (collectionName === 'catalogs' || fields.includes('key')) {
      code = 'CATALOG_EXISTS';
      message = `A catalog entry with key '${err.keyValue?.key || 'unknown'}' already exists.`;
    } else if (fields.length > 0) {
      code = 'RESOURCE_CONFLICT';
      message = `Duplicate unique value for ${fields.join(', ')}.`;
    }

    res.status(409).json({
      success: false,
      error: {
        code,
        message,
        details: fields.map((f) => ({
          field: f,
          issue: `Unique constraint violated`,
        })),
      },
      requestId,
    });
    return;
  }

  // Handle known application errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
      requestId,
    });
    return;
  }

  // Fallback for unhandled server errors
  console.error('[UnhandledError]', err);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal server error occurred',
    },
    requestId,
  });
}
