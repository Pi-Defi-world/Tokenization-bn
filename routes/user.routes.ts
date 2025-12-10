import { Router } from "express";
import * as UserController from "../controllers/users";
import { isAuthenticated } from "../middlewares/isAuthenticated";
import { loginRateLimiter } from "../middlewares/login-rate-limiter";

const userRoutes = Router()

// Apply login rate limiting to signin route
userRoutes.post("/signin", loginRateLimiter, UserController.handleSignInUser)
userRoutes.delete("/public-key", isAuthenticated, UserController.removePublicKey)

export default userRoutes