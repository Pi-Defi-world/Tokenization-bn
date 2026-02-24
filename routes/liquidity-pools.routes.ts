import { Router } from 'express';
import * as LiquidityPoolController from '../controllers/liquidity-pools';

const liquidityPoolRoutes = Router();

liquidityPoolRoutes.get('/user-pools', LiquidityPoolController.getUserLiquidityPools);
liquidityPoolRoutes.get('/user-tokens', LiquidityPoolController.getUserTokens);
liquidityPoolRoutes.get('/platform-pools', LiquidityPoolController.getPlatformPools);
liquidityPoolRoutes.get('/quote', LiquidityPoolController.quoteAddLiquidity);
liquidityPoolRoutes.get('/', LiquidityPoolController.listLiquidityPools);
liquidityPoolRoutes.get('/rewards', LiquidityPoolController.getUserLiquidityReward);
liquidityPoolRoutes.get('/:liquidityPoolId', LiquidityPoolController.getLiquidityPoolById);
liquidityPoolRoutes.post('/', LiquidityPoolController.createLiquidityPool);
liquidityPoolRoutes.post('/withdraw', LiquidityPoolController.withdrawFromLiquidityPool);
liquidityPoolRoutes.post('/deposit', LiquidityPoolController.depositToLiquidityPool);

export default liquidityPoolRoutes;

