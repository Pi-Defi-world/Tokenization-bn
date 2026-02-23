import { Request, Response } from 'express';
import { usersService } from '../../services/users.service';
import { logger } from '../../utils/logger';
import { recordFailedLoginAttempt, clearLoginAttempts } from '../../middlewares/login-rate-limiter';

export const handleSignInUser = async (req: Request, res: Response): Promise<any> => {
    const { authResult } = req.body;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const username = authResult?.user?.username;
    const uid = authResult?.user?.uid;

    try {
        const { user, token } = await usersService.signInUser(authResult);

        // Clear login attempts on successful login
        await clearLoginAttempts(req, { ip, username, uid });

        return res.status(200).json({
            user,
            token,
        });
    } catch (error: any) {
        // Record failed login attempt
        await recordFailedLoginAttempt(req, { ip, username, uid });

        // Determine appropriate status code and message
        let statusCode = 500;
        let message = 'Authentication failed';
        let code = 'AUTH_FAILED';

        if (error?.response?.status) {
            statusCode = error.response.status;
        } else if (error.message?.includes('Invalid') || error.message?.includes('expired')) {
            statusCode = 401;
        }

        // Extract error message
        if (error?.response?.data?.message) {
            message = error.response.data.message;
        } else if (error?.message) {
            message = error.message;
        }

        // Set error code based on status
        if (statusCode === 401) {
            code = 'UNAUTHORIZED';
        } else if (statusCode === 403) {
            code = 'FORBIDDEN';
        }

        logger.error('Sign in failed:', error);
        
        return res.status(statusCode).json({
            success: false,
            message,
            code,
            requestId: req.requestId,
        });
    }
};

export const removePublicKey = async (req: Request, res: Response): Promise<any> => {
    try {
        const currentUser = (req as any).currentUser;
        if (!currentUser) {
            return res.status(401).json({ message: 'Not authenticated' });
        }

        await usersService.removePublicKey(currentUser._id.toString());

        return res.status(200).json({
            success: true,
            message: 'Public key removed successfully',
        });
    } catch (error: any) {
        logger.error('❌ removePublicKey failed:', error);
        return res.status(500).json({
            message: error.message || 'Failed to remove public key',
        });
    }
};