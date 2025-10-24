import { Router } from "express";
import tokenRoutes from "./token.routes";
import { isAuthenticated } from "../middlewares/isAuthenticated";
import userRoutes from "./user.routes";



const appRoutes = Router()

appRoutes.use("/tokens",isAuthenticated,tokenRoutes)
appRoutes.use("/users",userRoutes)

export default appRoutes