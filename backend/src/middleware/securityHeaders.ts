import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';

/**
 * Enterprise HTTP Security Headers Middleware.
 * Implements OWASP recommended security headers equivalent to Helmet:
 * - Clickjacking defense (X-Frame-Options)
 * - MIME-sniffing prevention (X-Content-Type-Options)
 * - Cross-Site Scripting protection (X-XSS-Protection, CSP)
 * - Strict Transport Security (HSTS) in production
 * - Information disclosure prevention (hiding X-Powered-By)
 * - Referrer policy and cross-origin resource isolation
 */
export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
  // 1. Remove technology fingerprinting
  res.removeHeader('X-Powered-By');

  // 2. Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // 3. Prevent clickjacking (allow framing only from same origin)
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  // 4. Modern XSS auditor policy (0 disables buggy legacy browser auditors that can introduce vulnerabilities)
  res.setHeader('X-XSS-Protection', '0');

  // 5. Restrict referrer information sent with outbound links
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // 6. Prevent browser pre-rendering / prefetching cross-origin
  res.setHeader('X-DNS-Prefetch-Control', 'off');

  // 7. Prevent Internet Explorer from executing downloads in site's context
  res.setHeader('X-Download-Options', 'noopen');

  // 8. Prevent Flash/PDF cross-domain content execution
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

  // 9. Process isolation
  res.setHeader('Origin-Agent-Cluster', '?1');

  // 10. Cross-Origin Policies
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');

  // 11. Enforce HSTS on HTTPS in production
  if (
    env.NODE_ENV === 'production' &&
    (req.secure || req.headers['x-forwarded-proto'] === 'https')
  ) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // 12. Content Security Policy (allows API and media assets, restricts inline execution) (SEC-010)
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https: blob:",
    "media-src 'self' https: blob:",
    "connect-src 'self' https: wss:",
    "font-src 'self' data: https://fonts.gstatic.com https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ];

  if (env.NODE_ENV === 'production') {
    cspDirectives.push('upgrade-insecure-requests');
  }

  res.setHeader('Content-Security-Policy', cspDirectives.join('; '));

  next();
}
