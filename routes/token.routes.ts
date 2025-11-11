import { Router } from 'express';
import * as TokenController from '../controllers/tokens';
import { validateMintTokenFields } from '../middlewares/mint-token-validator';

const tokenRoutes = Router();

tokenRoutes.get('/',TokenController.getTokens);
tokenRoutes.post('/trustline', TokenController.trustline);
tokenRoutes.post('/mint',validateMintTokenFields,TokenController.mint);
tokenRoutes.post('/burn',TokenController.burnTokens);

export default tokenRoutes;
