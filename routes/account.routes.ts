import { Router } from 'express';
import { createWallet, changeWallet, getAccountBalance, getAccountOperations } from '../controllers/account';
import { getAccountTransactions } from '../controllers/transaction-history';
import { sendPayment } from '../controllers/account/send';
import { isAuthenticated } from '../middlewares/isAuthenticated';

const accountRoutes = Router();

accountRoutes.post('/create-wallet', isAuthenticated, createWallet);
accountRoutes.post('/change-wallet', isAuthenticated, changeWallet);
accountRoutes.get('/balance/:publicKey', getAccountBalance);
accountRoutes.get('/operations/:publicKey', getAccountOperations);
accountRoutes.get('/transactions/:publicKey', getAccountTransactions);
accountRoutes.post('/send', sendPayment);

export default accountRoutes;


