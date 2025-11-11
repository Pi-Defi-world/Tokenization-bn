
import { Router } from "express";
import { createSellOfferHandler, createBuyOfferHandler, cancelOfferHandler } from "../controllers/trade";

const tradeRoutes = Router();

tradeRoutes.post("/sell", createSellOfferHandler);
tradeRoutes.post("/buy", createBuyOfferHandler);
tradeRoutes.post("/cancel", cancelOfferHandler);

export default tradeRoutes;
