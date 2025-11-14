import { Router } from 'express';
import { importAccount, getAccountBalance, getAccountOperations } from '../controllers/account';
import { isAuthenticated } from '../middlewares/isAuthenticated';

const accountRoutes = Router();

accountRoutes.post('/import', isAuthenticated, importAccount);
accountRoutes.get('/balance/:publicKey', getAccountBalance);
accountRoutes.get('/operations/:publicKey', getAccountOperations);

export default accountRoutes;


