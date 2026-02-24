import { Router } from 'express';
import * as SavingsController from '../controllers/savings';

const savingsRoutes = Router();

savingsRoutes.get('/term-options', SavingsController.getTermOptions);
savingsRoutes.get('/products', SavingsController.listProducts);
savingsRoutes.post('/products', SavingsController.createProduct);
savingsRoutes.post('/deposit', SavingsController.deposit);
savingsRoutes.get('/positions', SavingsController.listPositions);
savingsRoutes.post('/positions/:positionId/withdraw', SavingsController.withdraw);

export default savingsRoutes;
