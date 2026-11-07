export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  requestId?: string;
  userId?: string;
  projectId?: string;
  assetId?: string;
  jobId?: string;
  planVersion?: number;
  durationMs?: number;
  error?: unknown;
  [key: string]: unknown;
}

export class StructuredLogger {
  private static redactSensitiveKeys = new Set([
    'authorization',
    'password',
    'secret',
    'apikey',
    'gemini_api_key',
    'openai_api_key',
    'internal_worker_secret',
    'accesskeyid',
    'secretaccesskey',
    'x-amz-signature',
    'x-amz-credential',
  ]);

  /**
   * Recursively sanitizes and redacts credentials, secrets, and signed URLs.
   */
  static redact(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj;

    if (typeof obj === 'string') {
      // Redact authorization Bearer tokens
      let sanitized = obj.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]');
      // Redact S3 query signatures
      sanitized = sanitized.replace(/([?&]X-Amz-Signature=)[^&]+/gi, '$1[REDACTED]');
      sanitized = sanitized.replace(/([?&]Signature=)[^&]+/gi, '$1[REDACTED]');
      return sanitized;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.redact(item));
    }

    if (typeof obj === 'object') {
      const clean: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (this.redactSensitiveKeys.has(key.toLowerCase())) {
          clean[key] = '[REDACTED]';
        } else {
          clean[key] = this.redact(value);
        }
      }
      return clean;
    }

    return obj;
  }

  static formatLog(level: LogLevel, message: string, context?: LogContext): string {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context ? (this.redact(context) as object) : {}),
    };
    return JSON.stringify(entry);
  }

  static info(message: string, context?: LogContext): void {
    console.log(this.formatLog('info', message, context));
  }

  static warn(message: string, context?: LogContext): void {
    console.warn(this.formatLog('warn', message, context));
  }

  static error(message: string, context?: LogContext): void {
    console.error(this.formatLog('error', message, context));
  }

  static debug(message: string, context?: LogContext): void {
    if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
      console.debug(this.formatLog('debug', message, context));
    }
  }
}
