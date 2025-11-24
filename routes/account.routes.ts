import { Router } from 'express';
import { importAccount, getAccountBalance, getAccountOperations } from '../controllers/account';
import { getAccountTransactions } from '../controllers/transaction-history';
import { isAuthenticated } from '../middlewares/isAuthenticated';

const accountRoutes = Router();

accountRoutes.post('/import', isAuthenticated, importAccount);
accountRoutes.get('/balance/:publicKey', getAccountBalance);
accountRoutes.get('/operations/:publicKey', getAccountOperations);
accountRoutes.get('/transactions/:publicKey', getAccountTransactions);

export default accountRoutes;


