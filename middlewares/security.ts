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
 * Sanitize string values in place (mutates the object)
 */
function sanitizeStringInPlace(obj: any): void {
  if (typeof obj === 'string') {
    // Sanitize string values - but we can't mutate strings, so this is for object properties
    return;
  }
  
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === 'string') {
        obj[i] = obj[i]
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/javascript:/gi, '');
      } else if (obj[i] && typeof obj[i] === 'object') {
        sanitizeStringInPlace(obj[i]);
      }
    }
  } else if (obj && typeof obj === 'object') {
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        if (typeof obj[key] === 'string') {
          obj[key] = obj[key]
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/javascript:/gi, '');
        } else if (obj[key] && typeof obj[key] === 'object') {
          sanitizeStringInPlace(obj[key]);
        }
      }
    }
  }
}

/**
 * Security middleware for input sanitization and validation
 */
export const securityMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  try {
    // Note: req.query is read-only in Express, so we can't sanitize it directly
    // Express already handles query parsing safely, so we skip query sanitization
    
    // Sanitize body string values in place (mutates req.body)
    if (req.body && typeof req.body === 'object') {
      sanitizeStringInPlace(req.body);
    }

    // Validate request size
    const contentLength = parseInt(req.get('content-length') || '0', 10);
    if (contentLength > MAX_REQUEST_SIZE) {
      loggingService.warn(
        `Request size exceeded: ${contentLength} bytes (max: ${MAX_REQUEST_SIZE})`,
        req
      );
      res.status(413).json({
        success: false,
        message: 'Request payload too large.',
        code: 'PAYLOAD_TOO_LARGE',
        requestId: req.requestId,
      });
      return;
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

