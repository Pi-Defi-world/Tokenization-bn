
import { Router } from "express";
import { getOrderBookHandler, getOffersByAccountHandler, getTradesHandler, getTradeAggregationsHandler } from "../controllers/orderbook";
import { searchAssetsHandler } from "../controllers/orderbook/search-assets";
import { getPriceStats } from "../controllers/trade-analytics";

const orderbookRoutes = Router();

orderbookRoutes.get("/orderbook", getOrderBookHandler);
orderbookRoutes.get("/offers/:account", getOffersByAccountHandler);
orderbookRoutes.get("/search-assets", searchAssetsHandler);
orderbookRoutes.get("/trades", getTradesHandler);
orderbookRoutes.get("/trade-aggregations", getTradeAggregationsHandler);
orderbookRoutes.get("/price-stats", getPriceStats); // New endpoint for price statistics

export default orderbookRoutes;
