import { Request, Response } from 'express';
import { usersService } from '../../services/users.service';
import { logger } from '../../utils/logger';


export const handleSignInUser = async (req: Request, res: Response): Promise<any> => {
    const { authResult } = req.body;
    try {
        const { user, token } = await usersService.signInUser(authResult);

        return res.status(200).json({
            user,
            token,
        });
    } catch (error) {
        console.log(error)
        return res.status(500).json({
            message: "Internal server error"
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