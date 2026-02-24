
import { Response, NextFunction,Request } from "express";
import { jwtService } from "../services/jwt.service";
import User from "../models/User";
import { logger } from "../utils/logger";


export const isAuthenticated = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Authorization token missing" });
  }

  try {
    // Use decodeTokenWithDetails to get more information about token errors
    const tokenResult = (jwtService as any).decodeTokenWithDetails(token);
    
    if (!tokenResult.payload) {
      // Token is invalid or expired
      if (tokenResult.isExpired) {
        logger.warn(`Expired token attempt: ${tokenResult.error}`);
        return res.status(401).json({ 
          message: "Token expired",
          code: "TOKEN_EXPIRED",
          expired: true
        });
      } else {
        logger.warn(`Invalid token attempt: ${tokenResult.error}`);
        return res.status(401).json({ 
          message: "Invalid token",
          code: "INVALID_TOKEN"
        });
      }
    }

    const currentUser = await User.findById(tokenResult.payload.id);
    if (currentUser) {
      (req as any).currentUser = currentUser;
      return next();
    } else {
      logger.warn(`User not found for token: ${tokenResult.payload.id}`);
      return res.status(401).json({ 
        message: "User not found",
        code: "USER_NOT_FOUND"
      });
    }
  } catch (error: any) {
    logger.error(`Authentication error: ${error.message}`);
    return res.status(401).json({ 
      message: "Authentication failed",
      code: "AUTH_ERROR"
    });
  }
};