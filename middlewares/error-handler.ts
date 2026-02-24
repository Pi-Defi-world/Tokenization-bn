import { Request, Response, NextFunction } from 'express';
import { loggingService } from '../services/logging.service';
import { toUserMessage } from '../utils/zyradex-error';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

/** Same shape everywhere: user-friendly message only, no codes. */
interface StandardErrorResponse {
  success: false;
  message: string;
}

/**
 * Classify error for status code and logging only. User-facing message comes from toUserMessage(err).
 */
function classifyError(err: any): { statusCode: number; isClientError: boolean } {
  if (err.status || err.statusCode) {
    const status = err.status || err.statusCode;
    return {
      statusCode: status,
      isClientError: status >= 400 && status < 500,
    };
  }
  if (err.name === 'ValidationError' || err.name === 'CastError') {
    return { statusCode: 400, isClientError: true };
  }
  if (err.code === 11000) {
    return { statusCode: 409, isClientError: true };
  }
  return { statusCode: 500, isClientError: false };
}

/**
 * Centralized error handling middleware
 * Must be added last in the middleware chain
 */
export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const { statusCode, isClientError } = classifyError(err);
  const message = toUserMessage(err);

  const errorResponse: StandardErrorResponse = {
    success: false,
    message,
  };

  if (isClientError) {
    loggingService.warn(`Client error: ${message}`, req, err, { statusCode });
  } else {
    loggingService.error(`Server error: ${message}`, req, err, { statusCode });
  }

  res.status(statusCode).json(errorResponse);
};

/**
 * 404 handler for unmatched routes
 */
export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
  loggingService.warn(`404 Not Found: ${req.method} ${req.originalUrl}`, req);
  res.status(404).json({
    success: false,
    message: 'This page or action was not found. Check the address and try again.',
  });
};

