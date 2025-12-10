import { Request } from 'express';
import Log from '../models/Log';
import { logger } from '../utils/logger';

const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = process.env.NODE_ENV === 'development';
const LOG_TO_MONGODB = process.env.LOG_TO_MONGODB !== 'false'; // Default to true
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();

// Log level priority
const LOG_LEVELS: Record<string, number> = {
  error: 0,
  warn: 1,
  info: 2,
  success: 2
};

const shouldLogToMongo = (level: string): boolean => {
  const currentLevel = LOG_LEVELS[LOG_LEVEL] ?? 2;
  const messageLevel = LOG_LEVELS[level] ?? 2;
  return messageLevel <= currentLevel;
};

interface LogContext {
  requestId?: string;
  userId?: string;
  ip?: string;
  route?: string;
  method?: string;
  userAgent?: string;
  duration?: number;
}

interface ErrorInfo {
  name?: string;
  message?: string;
  stack?: string;
  code?: string;
  status?: number;
}

/**
 * Enhanced logging service that logs to both console and MongoDB
 */
class LoggingService {
  /**
   * Extract context from Express request
   */
  private getContextFromRequest(req?: Request): LogContext {
    if (!req) return {};

    const context: LogContext = {
      requestId: req.requestId,
      ip: req.ip || req.socket?.remoteAddress || undefined,
      route: req.route?.path || req.originalUrl || req.url,
      method: req.method,
      userAgent: req.get('user-agent') || undefined,
    };

    // Calculate duration if startTime is available
    if (req.startTime) {
      context.duration = Date.now() - req.startTime;
    }

    // Add user ID if authenticated
    if ((req as any).currentUser) {
      context.userId = (req as any).currentUser._id?.toString();
    }

    return context;
  }

  /**
   * Extract error information from error object
   */
  private extractErrorInfo(err: any): ErrorInfo | undefined {
    if (!err) return undefined;

    if (err instanceof Error) {
      return {
        name: err.name,
        message: err.message,
        stack: isDevelopment ? err.stack : undefined,
        code: (err as any).code,
        status: (err as any).status || (err as any).statusCode,
      };
    }

    if (err.response) {
      return {
        name: 'AxiosError',
        message: err.message || 'Request failed',
        status: err.response.status,
        code: err.code,
      };
    }

    return {
      message: typeof err === 'string' ? err : JSON.stringify(err),
    };
  }

  /**
   * Log to MongoDB (async, non-blocking)
   */
  private async logToMongo(
    level: 'error' | 'warn' | 'info' | 'success',
    message: string,
    context?: LogContext,
    errorInfo?: ErrorInfo,
    metadata?: Record<string, any>
  ): Promise<void> {
    if (!LOG_TO_MONGODB || !shouldLogToMongo(level)) {
      return;
    }

    try {
      const logEntry = new Log({
        level,
        message,
        context: context || {},
        error: errorInfo,
        metadata: metadata || {},
      });

      // Save asynchronously, don't wait for it
      logEntry.save().catch((err) => {
        // Only log to console if MongoDB logging fails (avoid infinite loop)
        if (isDevelopment) {
          console.error('Failed to save log to MongoDB:', err);
        }
      });
    } catch (err) {
      // Silently fail - don't break the application if logging fails
      if (isDevelopment) {
        console.error('Logging service error:', err);
      }
    }
  }

  /**
   * Log info message
   */
  public info(message: string, req?: Request, metadata?: Record<string, any>): void {
    logger.info(message);
    const context = this.getContextFromRequest(req);
    this.logToMongo('info', message, context, undefined, metadata);
  }

  /**
   * Log success message
   */
  public success(message: string, req?: Request, metadata?: Record<string, any>): void {
    logger.success(message);
    const context = this.getContextFromRequest(req);
    this.logToMongo('success', message, context, undefined, metadata);
  }

  /**
   * Log warning message
   */
  public warn(message: string, req?: Request, err?: any, metadata?: Record<string, any>): void {
    logger.warn(message);
    const context = this.getContextFromRequest(req);
    const errorInfo = this.extractErrorInfo(err);
    this.logToMongo('warn', message, context, errorInfo, metadata);
  }

  /**
   * Log error message
   */
  public error(message: string, req?: Request, err?: any, metadata?: Record<string, any>): void {
    logger.error(message, err);
    const context = this.getContextFromRequest(req);
    const errorInfo = this.extractErrorInfo(err);
    this.logToMongo('error', message, context, errorInfo, metadata);
  }

  /**
   * Log with custom context (for use outside of request handlers)
   */
  public log(
    level: 'error' | 'warn' | 'info' | 'success',
    message: string,
    context?: LogContext,
    err?: any,
    metadata?: Record<string, any>
  ): void {
    switch (level) {
      case 'error':
        this.error(message, undefined, err, metadata);
        break;
      case 'warn':
        this.warn(message, undefined, err, metadata);
        break;
      case 'info':
        this.info(message, undefined, metadata);
        break;
      case 'success':
        this.success(message, undefined, metadata);
        break;
    }
  }
}

export const loggingService = new LoggingService();

