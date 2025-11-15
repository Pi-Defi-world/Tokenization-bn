
import { Router } from 'express';
import { createFee, getFees, updateFee, deleteFee } from '../controllers/fees';
import { isAuthenticated } from '../middlewares/isAuthenticated';
import { isAdmin } from '../middlewares/isAdmin';

const feeRoutes = Router();

feeRoutes.get('/', getFees);
feeRoutes.post('/', createFee);
feeRoutes.put('/:key', updateFee);
feeRoutes.delete('/:key', isAuthenticated, isAdmin, deleteFee);

export default feeRoutes;
