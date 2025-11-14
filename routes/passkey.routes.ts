import { Router } from 'express';
import {
  startRegistration,
  verifyRegistration,
  startAuthentication,
  verifyAuthentication,
  listPasskeys,
  deletePasskey,
} from '../controllers/passkey';
import { isAuthenticated } from '../middlewares/isAuthenticated';

const passkeyRoutes = Router();

passkeyRoutes.post('/register/start', isAuthenticated, startRegistration);
passkeyRoutes.post('/register/verify', isAuthenticated, verifyRegistration);
passkeyRoutes.post('/authenticate/start', isAuthenticated, startAuthentication);
passkeyRoutes.post('/authenticate/verify', isAuthenticated, verifyAuthentication);
passkeyRoutes.get('/list', isAuthenticated, listPasskeys);
passkeyRoutes.delete('/:credentialId', isAuthenticated, deletePasskey);

export default passkeyRoutes;

