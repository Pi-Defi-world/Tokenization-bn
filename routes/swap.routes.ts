import { Router } from 'express';
import { swapToken, quoteSwap, executeSwap, getPoolsForPair, distributeFees } from '../controllers/swap';
import { strictRateLimiter, standardRateLimiter } from '../middlewares/rateLimiter';

const swapRoutes = Router();

// Expensive operations get strict rate limiting
swapRoutes.post('/', strictRateLimiter, swapToken);
swapRoutes.get('/quote', standardRateLimiter, quoteSwap);
swapRoutes.post('/execute', strictRateLimiter, executeSwap);
swapRoutes.get('/pools-for-pair', standardRateLimiter, getPoolsForPair);
swapRoutes.post('/distribute-fees', strictRateLimiter, distributeFees);

export default swapRoutes;
