import { Router } from "express";
import tokenRoutes from "./token.routes";
import { isAuthenticated } from "../middlewares/isAuthenticated";
import userRoutes from "./user.routes";
import liquidityPoolRoutes from "./liquidity-pools.routes";
import swapRoutes from "./swap.routes";
import feeRoutes from "./fee.routes";
import pairRoutes from "./pairs.routes";
import orderbookRoutes from "./orderbook.routes";
import tradeRoutes from "./trade.routes";
import accountRoutes from "./account.routes";



const appRoutes = Router()

appRoutes.use("/tokens",isAuthenticated,tokenRoutes)
appRoutes.use("/users",userRoutes)
appRoutes.use("/liquidity-pools", liquidityPoolRoutes)
appRoutes.use("/swap", swapRoutes)
appRoutes.use("/fees", feeRoutes)
appRoutes.use("/pairs", pairRoutes)
appRoutes.use("/market", orderbookRoutes)
appRoutes.use("/trade", tradeRoutes)
appRoutes.use("/account", accountRoutes)
// Encrypted secret and passkey routes removed - users now provide secret seed directly for transactions

export default appRoutes