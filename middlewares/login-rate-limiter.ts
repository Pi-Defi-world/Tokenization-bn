import { Request, Response, NextFunction } from 'express';
import LoginAttempt from '../models/LoginAttempt';
import { loggingService } from '../services/logging.service';

// Configuration from environment or defaults
const MAX_LOGIN_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10);
const LOCKOUT_DURATION_MS = parseInt(process.env.LOGIN_LOCKOUT_DURATION_MS || '900000', 10); // 15 minutes default
const ATTEMPT_WINDOW_MS = parseInt(process.env.LOGIN_ATTEMPT_WINDOW_MS || '3600000', 10); // 1 hour default

/**
 * Login rate limiter middleware
 * Tracks failed login attempts by IP and username/uid
 * Locks accounts after too many failed attempts
 */
export const loginRateLimiter = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = new Date();
    
    // Extract username/uid from request body if available
    const username = req.body?.authResult?.user?.username;
    const uid = req.body?.authResult?.user?.uid;

    // Check IP-based attempts
    let ipAttempt = await LoginAttempt.findOne({ identifier: ip, type: 'ip' });
    
    if (ipAttempt) {
      // Check if IP is locked
      if (ipAttempt.lockedUntil && ipAttempt.lockedUntil > now) {
        const remainingMs = ipAttempt.lockedUntil.getTime() - now.getTime();
        const remainingMinutes = Math.ceil(remainingMs / 60000);
        
        loggingService.warn(
          `Login blocked: IP ${ip} is locked for ${remainingMinutes} more minutes`,
          req
        );
        
        res.status(429).json({
          success: false,
          message: `Too many failed login attempts. Please try again in ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}.`,
          code: 'LOGIN_LOCKED',
          retryAfter: Math.ceil(remainingMs / 1000),
          requestId: req.requestId,
        });
        return;
      }

      // Reset attempts if window has expired
      const timeSinceLastAttempt = now.getTime() - ipAttempt.lastAttempt.getTime();
      if (timeSinceLastAttempt > ATTEMPT_WINDOW_MS) {
        ipAttempt.attempts = 0;
        ipAttempt.lockedUntil = undefined;
      }
    }

    // Check username-based attempts if username is provided
    let usernameAttempt: any = null;
    if (username) {
      usernameAttempt = await LoginAttempt.findOne({ identifier: username, type: 'username' });
      
      if (usernameAttempt) {
        if (usernameAttempt.lockedUntil && usernameAttempt.lockedUntil > now) {
          const remainingMs = usernameAttempt.lockedUntil.getTime() - now.getTime();
          const remainingMinutes = Math.ceil(remainingMs / 60000);
          
          loggingService.warn(
            `Login blocked: Username ${username} is locked for ${remainingMinutes} more minutes`,
            req
          );
          
          res.status(429).json({
            success: false,
            message: `Account locked due to too many failed login attempts. Please try again in ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}.`,
            code: 'ACCOUNT_LOCKED',
            retryAfter: Math.ceil(remainingMs / 1000),
            requestId: req.requestId,
          });
          return;
        }

        // Reset attempts if window has expired
        const timeSinceLastAttempt = now.getTime() - usernameAttempt.lastAttempt.getTime();
        if (timeSinceLastAttempt > ATTEMPT_WINDOW_MS) {
          usernameAttempt.attempts = 0;
          usernameAttempt.lockedUntil = undefined;
        }
      }
    }

    // Check uid-based attempts if uid is provided
    let uidAttempt: any = null;
    if (uid) {
      uidAttempt = await LoginAttempt.findOne({ identifier: uid, type: 'uid' });
      
      if (uidAttempt) {
        if (uidAttempt.lockedUntil && uidAttempt.lockedUntil > now) {
          const remainingMs = uidAttempt.lockedUntil.getTime() - now.getTime();
          const remainingMinutes = Math.ceil(remainingMs / 60000);
          
          loggingService.warn(
            `Login blocked: UID ${uid} is locked for ${remainingMinutes} more minutes`,
            req
          );
          
          res.status(429).json({
            success: false,
            message: `Account locked due to too many failed login attempts. Please try again in ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}.`,
            code: 'ACCOUNT_LOCKED',
            retryAfter: Math.ceil(remainingMs / 1000),
            requestId: req.requestId,
          });
          return;
        }

        // Reset attempts if window has expired
        const timeSinceLastAttempt = now.getTime() - uidAttempt.lastAttempt.getTime();
        if (timeSinceLastAttempt > ATTEMPT_WINDOW_MS) {
          uidAttempt.attempts = 0;
          uidAttempt.lockedUntil = undefined;
        }
      }
    }

    // Attach attempt tracking to request for use in controller
    (req as any).loginAttemptTracking = {
      ip,
      username,
      uid,
      ipAttempt,
      usernameAttempt,
      uidAttempt,
    };

    next();
  } catch (error: any) {
    // If rate limiting check fails, log but allow request to proceed
    // This prevents rate limiting from breaking the application
    loggingService.error('Login rate limiter error', req, error);
    next();
  }
};

/**
 * Record a failed login attempt
 */
export const recordFailedLoginAttempt = async (
  req: Request,
  identifier: { ip: string; username?: string; uid?: string }
): Promise<void> => {
  try {
    const now = new Date();
    const lockUntil = new Date(now.getTime() + LOCKOUT_DURATION_MS);

    // Record IP attempt
    let ipAttempt = await LoginAttempt.findOneAndUpdate(
      { identifier: identifier.ip, type: 'ip' },
      {
        $inc: { attempts: 1 },
        $set: { lastAttempt: now }
      },
      { upsert: true, new: true }
    );

    // Lock IP if max attempts reached
    if (ipAttempt.attempts >= MAX_LOGIN_ATTEMPTS) {
      ipAttempt.lockedUntil = lockUntil;
      await ipAttempt.save();
      
      loggingService.warn(
        `IP ${identifier.ip} locked after ${ipAttempt.attempts} failed login attempts`,
        req
      );
    }

    // Record username attempt if provided
    if (identifier.username) {
      let usernameAttempt = await LoginAttempt.findOneAndUpdate(
        { identifier: identifier.username, type: 'username' },
        {
          $inc: { attempts: 1 },
          $set: { lastAttempt: now }
        },
        { upsert: true, new: true }
      );

      if (usernameAttempt.attempts >= MAX_LOGIN_ATTEMPTS) {
        usernameAttempt.lockedUntil = lockUntil;
        await usernameAttempt.save();
        
        loggingService.warn(
          `Username ${identifier.username} locked after ${usernameAttempt.attempts} failed login attempts`,
          req
        );
      }
    }

    // Record uid attempt if provided
    if (identifier.uid) {
      let uidAttempt = await LoginAttempt.findOneAndUpdate(
        { identifier: identifier.uid, type: 'uid' },
        {
          $inc: { attempts: 1 },
          $set: { lastAttempt: now }
        },
        { upsert: true, new: true }
      );

      if (uidAttempt.attempts >= MAX_LOGIN_ATTEMPTS) {
        uidAttempt.lockedUntil = lockUntil;
        await uidAttempt.save();
        
        loggingService.warn(
          `UID ${identifier.uid} locked after ${uidAttempt.attempts} failed login attempts`,
          req
        );
      }
    }
  } catch (error: any) {
    // Log error but don't throw - don't break login flow if tracking fails
    loggingService.error('Failed to record login attempt', req, error);
  }
};

/**
 * Clear login attempts on successful login
 */
export const clearLoginAttempts = async (
  req: Request,
  identifier: { ip: string; username?: string; uid?: string }
): Promise<void> => {
  try {
    // Clear IP attempts
    await LoginAttempt.findOneAndUpdate(
      { identifier: identifier.ip, type: 'ip' },
      {
        $set: { attempts: 0, lockedUntil: undefined }
      }
    );

    // Clear username attempts if provided
    if (identifier.username) {
      await LoginAttempt.findOneAndUpdate(
        { identifier: identifier.username, type: 'username' },
        {
          $set: { attempts: 0, lockedUntil: undefined }
        }
      );
    }

    // Clear uid attempts if provided
    if (identifier.uid) {
      await LoginAttempt.findOneAndUpdate(
        { identifier: identifier.uid, type: 'uid' },
        {
          $set: { attempts: 0, lockedUntil: undefined }
        }
      );
    }
  } catch (error: any) {
    // Log error but don't throw - don't break login flow if clearing fails
    loggingService.error('Failed to clear login attempts', req, error);
  }
};

