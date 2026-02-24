import { Router } from 'express';
import * as LendingController from '../controllers/lending';

const lendingRoutes = Router();

lendingRoutes.get('/pools', LendingController.listPools);
lendingRoutes.post('/pools', LendingController.createPool);
lendingRoutes.post('/pools/:poolId/supply', LendingController.supply);
lendingRoutes.post('/pools/:poolId/withdraw', LendingController.withdraw);
lendingRoutes.post('/pools/:poolId/borrow', LendingController.borrow);
lendingRoutes.get('/positions', LendingController.getPositions);
lendingRoutes.post('/positions/:borrowPositionId/repay', LendingController.repay);
lendingRoutes.post('/positions/:borrowPositionId/liquidate', LendingController.liquidate);
lendingRoutes.get('/prices', LendingController.getPrices);
lendingRoutes.get('/credit-score', LendingController.getCreditScore);
lendingRoutes.post('/credit-score', LendingController.setCreditScore);
lendingRoutes.get('/fee-destination', LendingController.getFeeDestination);

export default lendingRoutes;
