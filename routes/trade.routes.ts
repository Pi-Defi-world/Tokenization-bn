import { Router } from "express";
import { createSellOfferHandler, createBuyOfferHandler, cancelOfferHandler } from "../controllers/trade";
import { strictRateLimiter } from "../middlewares/rateLimiter";

const tradeRoutes = Router();

tradeRoutes.post("/sell", strictRateLimiter, createSellOfferHandler);
tradeRoutes.post("/buy", strictRateLimiter, createBuyOfferHandler);
tradeRoutes.post("/cancel", strictRateLimiter, cancelOfferHandler);

export default tradeRoutes;
