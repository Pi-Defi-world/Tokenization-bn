import { Router } from 'express';
import { isAuthenticated } from '../middlewares/isAuthenticated';
import { importAccount, getAccountBalance, getAccountOperations, linkWallet } from '../controllers/account';

const accountRoutes = Router();

accountRoutes.post('/import', importAccount);
accountRoutes.post('/link-wallet', isAuthenticated, linkWallet);
accountRoutes.get('/balance/:publicKey', getAccountBalance);
accountRoutes.get('/operations/:publicKey', getAccountOperations);

export default accountRoutes;


