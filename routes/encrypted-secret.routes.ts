import { Router } from 'express';
import {
  storeEncryptedSecret,
  getEncryptedSecret,
  hasStoredSecret,
  deleteEncryptedSecret,
  storePasswordAttempts,
  getPasswordAttempts,
  resetPasswordAttempts,
  isAccountLocked,
} from '../controllers/encrypted-secret';
import { isAuthenticated } from '../middlewares/isAuthenticated';

const encryptedSecretRoutes = Router();

encryptedSecretRoutes.post('/', isAuthenticated, storeEncryptedSecret);
encryptedSecretRoutes.get('/:publicKey', isAuthenticated, getEncryptedSecret);
encryptedSecretRoutes.get('/:publicKey/exists', isAuthenticated, hasStoredSecret);
encryptedSecretRoutes.delete('/:publicKey', isAuthenticated, deleteEncryptedSecret);
encryptedSecretRoutes.post('/:publicKey/attempts', isAuthenticated, storePasswordAttempts);
encryptedSecretRoutes.get('/:publicKey/attempts', isAuthenticated, getPasswordAttempts);
encryptedSecretRoutes.delete('/:publicKey/attempts', isAuthenticated, resetPasswordAttempts);
encryptedSecretRoutes.get('/:publicKey/locked', isAuthenticated, isAccountLocked);

export default encryptedSecretRoutes;

