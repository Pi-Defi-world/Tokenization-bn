
import { Router } from "express";
import { getOrderBookHandler, getOffersByAccountHandler } from "../controllers/orderbook";

const orderbookRoutes = Router();

orderbookRoutes.get("/orderbook", getOrderBookHandler);
orderbookRoutes.get("/offers/:account", getOffersByAccountHandler);

export default orderbookRoutes;
