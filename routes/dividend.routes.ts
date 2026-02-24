import { Router } from 'express';
import * as DividendController from '../controllers/dividend';

const dividendRoutes = Router();

dividendRoutes.post('/:roundId/snapshot', DividendController.runSnapshot);
dividendRoutes.get('/:roundId', DividendController.getRound);
dividendRoutes.get('/:roundId/holders', DividendController.getHolders);
dividendRoutes.post('/:roundId/claim', DividendController.recordClaim);

export default dividendRoutes;
