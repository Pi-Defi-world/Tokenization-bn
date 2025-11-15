
import { Router } from "express";
import { getOrderBookHandler, getOffersByAccountHandler } from "../controllers/orderbook";
import { searchAssetsHandler } from "../controllers/orderbook/search-assets";

const orderbookRoutes = Router();

orderbookRoutes.get("/orderbook", getOrderBookHandler);
orderbookRoutes.get("/offers/:account", getOffersByAccountHandler);
orderbookRoutes.get("/search-assets", searchAssetsHandler);

export default orderbookRoutes;
