import { Router } from 'express';
import { createWallet, getAccountBalance, getAccountOperations } from '../controllers/account';
import { getAccountTransactions } from '../controllers/transaction-history';
import { isAuthenticated } from '../middlewares/isAuthenticated';

const accountRoutes = Router();

accountRoutes.post('/create-wallet', isAuthenticated, createWallet);
accountRoutes.get('/balance/:publicKey', getAccountBalance);
accountRoutes.get('/operations/:publicKey', getAccountOperations);
accountRoutes.get('/transactions/:publicKey', getAccountTransactions);

export default accountRoutes;


