import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import RateLimit from '../models/RateLimit';
import env from '../config/env';

// Default rate limit configuration from environment or defaults
const DEFAULT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
const DEFAULT_MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10);
const STRICT_MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_STRICT_MAX || '30', 10);

/**
 * Sliding window rate limiter using MongoDB
 * Supports both IP-based and user-based rate limiting
 */
export const rateLimiter = (
  windowMs: number = DEFAULT_WINDOW_MS, 
  maxRequests: number = DEFAULT_MAX_REQUESTS,
  useUserBased: boolean = false
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const now = Date.now();
      let key: string;
      let type: 'ip' | 'user';

      // Determine rate limit key (user-based for authenticated routes, IP-based otherwise)
      if (useUserBased && (req as any).currentUser) {
        key = (req as any).currentUser._id.toString();
        type = 'user';
      } else {
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        key = ip;
        type = 'ip';
      }

      // Find or create rate limit record
      let rateLimitRecord = await RateLimit.findOne({ key, type });

      if (!rateLimitRecord) {
        // Create new rate limit record
        rateLimitRecord = new RateLimit({
          key,
          type,
          count: 1,
          windowStart: new Date(now),
          windowMs,
          maxRequests
        });
        await rateLimitRecord.save();
        
        // Set headers and continue
        res.setHeader('X-RateLimit-Limit', maxRequests.toString());
        res.setHeader('X-RateLimit-Remaining', (maxRequests - 1).toString());
        res.setHeader('X-RateLimit-Reset', new Date(now + windowMs).toISOString());
        return next();
      }

      // Sliding window algorithm: check if current window has expired
      const windowStartTime = rateLimitRecord.windowStart.getTime();
      const windowEndTime = windowStartTime + windowMs;

      if (now >= windowEndTime) {
        // Window expired, start new window
        rateLimitRecord.count = 1;
        rateLimitRecord.windowStart = new Date(now);
        await rateLimitRecord.save();
        
        res.setHeader('X-RateLimit-Limit', maxRequests.toString());
        res.setHeader('X-RateLimit-Remaining', (maxRequests - 1).toString());
        res.setHeader('X-RateLimit-Reset', new Date(now + windowMs).toISOString());
        return next();
      }

      // Window still active, increment count
      rateLimitRecord.count += 1;
      await rateLimitRecord.save();

      // Check if limit exceeded
      if (rateLimitRecord.count > maxRequests) {
        const retryAfter = Math.ceil((windowEndTime - now) / 1000);
        res.setHeader('Retry-After', retryAfter.toString());
        res.setHeader('X-RateLimit-Limit', maxRequests.toString());
        res.setHeader('X-RateLimit-Remaining', '0');
        res.setHeader('X-RateLimit-Reset', new Date(windowEndTime).toISOString());
        
        const identifier = type === 'user' ? `User ${key}` : `IP ${key}`;
        logger.warn(`Rate limit exceeded for ${identifier} (${rateLimitRecord.count} requests in ${windowMs}ms)`);
        
        return res.status(429).json({
          success: false,
          message: 'Too many requests. Please try again later.',
          retryAfter,
          code: 'RATE_LIMIT_EXCEEDED'
        });
      }

      // Within limit, set headers and continue
      const remaining = Math.max(0, maxRequests - rateLimitRecord.count);
      res.setHeader('X-RateLimit-Limit', maxRequests.toString());
      res.setHeader('X-RateLimit-Remaining', remaining.toString());
      res.setHeader('X-RateLimit-Reset', new Date(windowEndTime).toISOString());

      next();
    } catch (error: any) {
      // If rate limiting fails, log error but allow request to proceed
      // This prevents rate limiting from breaking the application
      logger.error('Rate limiter error:', error);
      next();
    }
  };
};

// Preset rate limiters
export const strictRateLimiter = rateLimiter(60000, STRICT_MAX_REQUESTS, false);
export const standardRateLimiter = rateLimiter(DEFAULT_WINDOW_MS, DEFAULT_MAX_REQUESTS, false);
export const lenientRateLimiter = rateLimiter(60000, 200, false);

// User-based rate limiters (for authenticated routes)
export const userStrictRateLimiter = rateLimiter(60000, STRICT_MAX_REQUESTS, true);
export const userStandardRateLimiter = rateLimiter(DEFAULT_WINDOW_MS, DEFAULT_MAX_REQUESTS, true); 

