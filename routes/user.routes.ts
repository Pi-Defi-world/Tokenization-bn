import { Router } from "express";
import { isAuthenticated } from "../middlewares/isAuthenticated";
import * as UserController from "../controllers/users";

const userRoutes = Router();

userRoutes.post("/signin", UserController.handleSignInUser);
userRoutes.get("/me", isAuthenticated, UserController.getMe);

export default userRoutes;