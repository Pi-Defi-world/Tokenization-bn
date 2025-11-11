
import { Router } from 'express';
import { createFee, getFees, updateFee } from '../controllers/fees';

const feeRoutes = Router();

feeRoutes.get('/', getFees);
feeRoutes.post('/', createFee);
feeRoutes.put('/:key', updateFee);

export default feeRoutes;
