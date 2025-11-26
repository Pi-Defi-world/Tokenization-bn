
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
    const decoded = jwtService.decodeToken(token);
    const currentUser = await User.findById(decoded?.id);
    if (currentUser) {
      (req as any).currentUser = currentUser;
      return next();
    } else {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};