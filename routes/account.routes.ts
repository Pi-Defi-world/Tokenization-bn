import { Router } from 'express';
import { importAccount, getAccountBalance, getAccountOperations } from '../controllers/account';

const accountRoutes = Router();

accountRoutes.post('/import', importAccount);
accountRoutes.get('/balance/:publicKey', getAccountBalance);
accountRoutes.get('/operations/:publicKey', getAccountOperations);

export default accountRoutes;


