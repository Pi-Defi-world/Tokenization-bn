import { Router } from 'express';
import { swapToken, quoteSwap, executeSwap, getPoolsForPair, distributeFees } from '../controllers/swap';

const swapRoutes = Router();

swapRoutes.post('/', swapToken);
swapRoutes.get('/quote', quoteSwap);
swapRoutes.post('/execute', executeSwap);
swapRoutes.get('/pools-for-pair', getPoolsForPair);
swapRoutes.post('/distribute-fees', distributeFees);

export default swapRoutes;
