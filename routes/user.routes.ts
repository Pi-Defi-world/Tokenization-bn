import { Router } from "express";
import * as UserController from "../controllers/users";
import { isAuthenticated } from "../middlewares/isAuthenticated";



const userRoutes = Router()

userRoutes.post("/signin",UserController.handleSignInUser)
userRoutes.delete("/public-key", isAuthenticated, UserController.removePublicKey)


export default userRoutes