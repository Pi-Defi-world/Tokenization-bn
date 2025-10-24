import { Router } from "express";
import * as UserController from "../controllers/users";



const userRoutes = Router()

userRoutes.post("/signin",UserController.handleSignInUser)


export default userRoutes