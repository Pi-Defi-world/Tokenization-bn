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
import passkeyRoutes from "./passkey.routes";
import encryptedSecretRoutes from "./encrypted-secret.routes";



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
appRoutes.use("/passkey", passkeyRoutes)
appRoutes.use("/encrypted-secret", encryptedSecretRoutes)

export default appRoutes