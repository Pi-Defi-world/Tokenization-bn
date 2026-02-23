import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

// Extend Express Request type to include our custom properties
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      startTime?: number;
    }
  }
}

/**
 * Request context middleware
 * Generates unique request ID and attaches context to request object
 * This context is used by logger and error handler
 */
export const requestContext = (req: Request, res: Response, next: NextFunction) => {
  // Generate unique request ID
  req.requestId = randomUUID();
  req.startTime = Date.now();

  // Add request ID to response headers for debugging
  res.setHeader('X-Request-ID', req.requestId);

  next();
};

