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
