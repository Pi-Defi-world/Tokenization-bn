import { Request, Response, NextFunction } from 'express';
import { loggingService } from '../services/logging.service';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

interface StandardErrorResponse {
  success: false;
  message: string;
  error?: string;
  code?: string;
  suggestion?: string;
  retryAfter?: number;
  requestId?: string;
}

/**
 * Classify error type
 */
function classifyError(err: any): {
  statusCode: number;
  isClientError: boolean;
  code: string;
  message: string;
  suggestion?: string;
} {
  // Handle known error types
  if (err.status || err.statusCode) {
    const status = err.status || err.statusCode;
    const isClientError = status >= 400 && status < 500;

    let code = 'UNKNOWN_ERROR';
    let message = err.message || 'An error occurred';
    let suggestion: string | undefined;

    switch (status) {
      case 400:
        code = 'BAD_REQUEST';
        message = err.message || 'Invalid request. Please check your input.';
        suggestion = 'Please review your request and try again.';
        break;
      case 401:
        code = 'UNAUTHORIZED';
        message = err.message || 'Authentication required. Please sign in again.';
        suggestion = 'Please sign in and try again.';
        break;
      case 403:
        code = 'FORBIDDEN';
        message = err.message || 'Access denied. You don\'t have permission for this action.';
        suggestion = 'Please contact support if you believe this is an error.';
        break;
      case 404:
        code = 'NOT_FOUND';
        message = err.message || 'Resource not found.';
        suggestion = 'Please check the URL and try again.';
        break;
      case 409:
        code = 'CONFLICT';
        message = err.message || 'Resource conflict.';
        break;
      case 429:
        code = 'RATE_LIMIT_EXCEEDED';
        message = err.message || 'Too many requests. Please try again later.';
        suggestion = `Please wait ${err.retryAfter || 60} seconds before trying again.`;
        break;
      case 500:
        code = 'INTERNAL_SERVER_ERROR';
        message = 'Server error. Please try again later.';
        suggestion = 'If the problem persists, please contact support.';
        break;
      case 503:
        code = 'SERVICE_UNAVAILABLE';
        message = 'Service temporarily unavailable.';
        suggestion = 'Please try again in a few moments.';
        break;
      default:
        code = isClientError ? 'CLIENT_ERROR' : 'SERVER_ERROR';
    }

    // Use suggestion from error if provided
    if (err.suggestion) {
      suggestion = err.suggestion;
    }

    return {
      statusCode: status,
      isClientError,
      code,
      message,
      suggestion,
    };
  }

  // Handle validation errors
  if (err.name === 'ValidationError' || err.name === 'CastError') {
    return {
      statusCode: 400,
      isClientError: true,
      code: 'VALIDATION_ERROR',
      message: err.message || 'Validation failed.',
      suggestion: 'Please check your input and try again.',
    };
  }

  // Handle MongoDB duplicate key errors
  if (err.code === 11000) {
    return {
      statusCode: 409,
      isClientError: true,
      code: 'DUPLICATE_ENTRY',
      message: 'This resource already exists.',
      suggestion: 'Please use a different value or update the existing resource.',
    };
  }

  // Default to 500 for unknown errors
  return {
    statusCode: 500,
    isClientError: false,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected error occurred.',
    suggestion: 'Please try again later. If the problem persists, contact support.',
  };
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
  const classification = classifyError(err);
  const requestId = req.requestId;

  // Build error response
  const errorResponse: StandardErrorResponse = {
    success: false,
    message: classification.message,
    code: classification.code,
    requestId,
  };

  // Add suggestion if available
  if (classification.suggestion) {
    errorResponse.suggestion = classification.suggestion;
  }

  // Add retryAfter for rate limit errors
  if (classification.code === 'RATE_LIMIT_EXCEEDED' && err.retryAfter) {
    errorResponse.retryAfter = err.retryAfter;
  }

  // Include technical error details only in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.error = err.message || String(err);
    if (err.stack) {
      // Stack trace is logged but not sent to client
    }
  }

  // Log error to MongoDB
  if (classification.isClientError) {
    // Client errors are warnings (user mistakes, not system issues)
    loggingService.warn(
      `Client error: ${classification.message}`,
      req,
      err,
      {
        code: classification.code,
        statusCode: classification.statusCode,
      }
    );
  } else {
    // Server errors are critical
    loggingService.error(
      `Server error: ${classification.message}`,
      req,
      err,
      {
        code: classification.code,
        statusCode: classification.statusCode,
      }
    );
  }

  // Send error response
  res.status(classification.statusCode).json(errorResponse);
};

/**
 * 404 handler for unmatched routes
 */
export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
  const errorResponse: StandardErrorResponse = {
    success: false,
    message: 'Route not found.',
    code: 'NOT_FOUND',
    requestId: req.requestId,
    suggestion: 'Please check the URL and try again.',
  };

  loggingService.warn(`404 Not Found: ${req.method} ${req.originalUrl}`, req);

  res.status(404).json(errorResponse);
};

