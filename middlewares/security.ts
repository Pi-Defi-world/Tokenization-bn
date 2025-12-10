import { Request, Response, NextFunction } from 'express';
import { loggingService } from '../services/logging.service';

const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || '30000', 10);
const MAX_REQUEST_SIZE = parseInt(process.env.MAX_REQUEST_SIZE || '10485760', 10); // 10MB default

/**
 * Basic input sanitization to prevent XSS
 */
function sanitizeInput(input: any): any {
  if (typeof input === 'string') {
    // Remove potentially dangerous characters
    return input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .trim();
  }

  if (Array.isArray(input)) {
    return input.map(sanitizeInput);
  }

  if (input && typeof input === 'object') {
    const sanitized: any = {};
    for (const key in input) {
      if (Object.prototype.hasOwnProperty.call(input, key)) {
        sanitized[key] = sanitizeInput(input[key]);
      }
    }
    return sanitized;
  }

  return input;
}

/**
 * Security middleware for input sanitization and validation
 */
export const securityMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  try {
    // Sanitize query parameters
    if (req.query && Object.keys(req.query).length > 0) {
      req.query = sanitizeInput(req.query);
    }

    // Sanitize body (but preserve structure for API requests)
    // Only sanitize string values, not the entire structure
    if (req.body && typeof req.body === 'object') {
      // Deep sanitize string values only
      const sanitizeBody = (obj: any): any => {
        if (typeof obj === 'string') {
          // Only remove script tags and dangerous patterns, keep other content
          return obj
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/javascript:/gi, '');
        }
        if (Array.isArray(obj)) {
          return obj.map(sanitizeBody);
        }
        if (obj && typeof obj === 'object') {
          const sanitized: any = {};
          for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
              sanitized[key] = sanitizeBody(obj[key]);
            }
          }
          return sanitized;
        }
        return obj;
      };
      req.body = sanitizeBody(req.body);
    }

    // Validate request size
    const contentLength = parseInt(req.get('content-length') || '0', 10);
    if (contentLength > MAX_REQUEST_SIZE) {
      loggingService.warn(
        `Request size exceeded: ${contentLength} bytes (max: ${MAX_REQUEST_SIZE})`,
        req
      );
      return res.status(413).json({
        success: false,
        message: 'Request payload too large.',
        code: 'PAYLOAD_TOO_LARGE',
        requestId: req.requestId,
      });
    }

    // Set request timeout
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      loggingService.warn(`Request timeout: ${req.method} ${req.originalUrl}`, req);
      if (!res.headersSent) {
        res.status(408).json({
          success: false,
          message: 'Request timeout. Please try again.',
          code: 'REQUEST_TIMEOUT',
          requestId: req.requestId,
        });
      }
    });

    next();
  } catch (error: any) {
    loggingService.error('Security middleware error', req, error);
    next(error);
  }
};

/**
 * Enhanced CORS configuration
 * Note: Basic CORS is already configured in app.ts, this adds additional security
 */
export const corsSecurity = (req: Request, res: Response, next: NextFunction): void => {
  // Add security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Content Security Policy (adjust based on your needs)
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';"
  );

  next();
};

