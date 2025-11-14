import { Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { EncryptedSecretService } from '../../services/encrypted-secret.service';

const encryptedSecretService = new EncryptedSecretService();

/**
 * Store encrypted secret
 * POST /v1/encrypted-secret
 */
export const storeEncryptedSecret = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).currentUser;
    const { publicKey, encryptedSecret, iv, salt } = req.body || {};

    if (!currentUser) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    if (!publicKey || !encryptedSecret || !iv || !salt) {
      return res.status(400).json({ message: 'Missing required fields: publicKey, encryptedSecret, iv, salt' });
    }

    await encryptedSecretService.storeEncryptedSecret({
      userId: currentUser._id.toString(),
      publicKey,
      encryptedSecret,
      iv,
      salt,
    });

    return res.status(200).json({ success: true, message: 'Encrypted secret stored successfully' });
  } catch (err: any) {
    logger.error('❌ storeEncryptedSecret failed:', err);
    return res.status(500).json({ message: err.message || 'Failed to store encrypted secret', error: err.message });
  }
};

/**
 * Get encrypted secret
 * GET /v1/encrypted-secret/:publicKey
 */
export const getEncryptedSecret = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).currentUser;
    const { publicKey } = req.params;

    if (!currentUser) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    if (!publicKey) {
      return res.status(400).json({ message: 'publicKey is required' });
    }

    const secret = await encryptedSecretService.getEncryptedSecret({
      userId: currentUser._id.toString(),
      publicKey,
    });

    if (!secret) {
      return res.status(404).json({ message: 'Encrypted secret not found' });
    }

    return res.status(200).json(secret);
  } catch (err: any) {
    logger.error('❌ getEncryptedSecret failed:', err);
    return res.status(500).json({ message: err.message || 'Failed to get encrypted secret', error: err.message });
  }
};

/**
 * Check if user has stored secret
 * GET /v1/encrypted-secret/:publicKey/exists
 */
export const hasStoredSecret = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).currentUser;
    const { publicKey } = req.params;

    if (!currentUser) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    if (!publicKey) {
      return res.status(400).json({ message: 'publicKey is required' });
    }

    const exists = await encryptedSecretService.hasStoredSecret({
      userId: currentUser._id.toString(),
      publicKey,
    });

    return res.status(200).json({ hasStoredSecret: exists });
  } catch (err: any) {
    logger.error('❌ hasStoredSecret failed:', err);
    return res.status(500).json({ message: err.message || 'Failed to check stored secret', error: err.message });
  }
};

/**
 * Delete encrypted secret
 * DELETE /v1/encrypted-secret/:publicKey
 */
export const deleteEncryptedSecret = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).currentUser;
    const { publicKey } = req.params;

    if (!currentUser) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    if (!publicKey) {
      return res.status(400).json({ message: 'publicKey is required' });
    }

    await encryptedSecretService.deleteEncryptedSecret({
      userId: currentUser._id.toString(),
      publicKey,
    });

    return res.status(200).json({ success: true, message: 'Encrypted secret deleted successfully' });
  } catch (err: any) {
    logger.error('❌ deleteEncryptedSecret failed:', err);
    return res.status(500).json({ message: err.message || 'Failed to delete encrypted secret', error: err.message });
  }
};

/**
 * Store password attempts
 * POST /v1/encrypted-secret/:publicKey/attempts
 */
export const storePasswordAttempts = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).currentUser;
    const { publicKey } = req.params;
    const { attempts } = req.body || {};

    if (!currentUser) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    if (!publicKey) {
      return res.status(400).json({ message: 'publicKey is required' });
    }

    if (typeof attempts !== 'number') {
      return res.status(400).json({ message: 'attempts must be a number' });
    }

    await encryptedSecretService.storePasswordAttempts(
      currentUser._id.toString(),
      publicKey,
      attempts
    );

    return res.status(200).json({ success: true, message: 'Password attempts stored successfully' });
  } catch (err: any) {
    logger.error('❌ storePasswordAttempts failed:', err);
    return res.status(500).json({ message: err.message || 'Failed to store password attempts', error: err.message });
  }
};

/**
 * Get password attempts
 * GET /v1/encrypted-secret/:publicKey/attempts
 */
export const getPasswordAttempts = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).currentUser;
    const { publicKey } = req.params;

    if (!currentUser) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    if (!publicKey) {
      return res.status(400).json({ message: 'publicKey is required' });
    }

    const attempts = await encryptedSecretService.getPasswordAttempts(
      currentUser._id.toString(),
      publicKey
    );

    return res.status(200).json({ attempts });
  } catch (err: any) {
    logger.error('❌ getPasswordAttempts failed:', err);
    return res.status(500).json({ message: err.message || 'Failed to get password attempts', error: err.message });
  }
};

/**
 * Reset password attempts
 * DELETE /v1/encrypted-secret/:publicKey/attempts
 */
export const resetPasswordAttempts = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).currentUser;
    const { publicKey } = req.params;

    if (!currentUser) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    if (!publicKey) {
      return res.status(400).json({ message: 'publicKey is required' });
    }

    await encryptedSecretService.resetPasswordAttempts(
      currentUser._id.toString(),
      publicKey
    );

    return res.status(200).json({ success: true, message: 'Password attempts reset successfully' });
  } catch (err: any) {
    logger.error('❌ resetPasswordAttempts failed:', err);
    return res.status(500).json({ message: err.message || 'Failed to reset password attempts', error: err.message });
  }
};

/**
 * Check if account is locked
 * GET /v1/encrypted-secret/:publicKey/locked
 */
export const isAccountLocked = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).currentUser;
    const { publicKey } = req.params;

    if (!currentUser) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    if (!publicKey) {
      return res.status(400).json({ message: 'publicKey is required' });
    }

    const locked = await encryptedSecretService.isAccountLocked(
      currentUser._id.toString(),
      publicKey
    );

    return res.status(200).json({ locked });
  } catch (err: any) {
    logger.error('❌ isAccountLocked failed:', err);
    return res.status(500).json({ message: err.message || 'Failed to check account lock status', error: err.message });
  }
};

