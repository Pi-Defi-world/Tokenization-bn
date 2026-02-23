import { Response, NextFunction, Request } from "express";
import { logger } from "../utils/logger";
import { IUser } from "../types";

/**
 * Middleware to check if the authenticated user has admin role
 * Should be used AFTER isAuthenticated middleware
 */
export const isAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  const currentUser = (req as any).currentUser as IUser;

  if (!currentUser) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  if (currentUser.role !== "admin") {
    logger.warn(`Admin access denied for user ${currentUser.username} (role: ${currentUser.role})`);
    return res.status(403).json({ message: "Admin access required" });
  }

  return next();
};

