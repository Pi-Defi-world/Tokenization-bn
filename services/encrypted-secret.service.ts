import EncryptedSecret from '../models/EncryptedSecret';
import PasswordAttempts from '../models/PasswordAttempts';
import User from '../models/User';
import { logger } from '../utils/logger';

export interface StoreEncryptedSecretInput {
  userId: string;
  publicKey: string;
  encryptedSecret: string;
  iv: string;
  salt: string;
}

export interface GetEncryptedSecretInput {
  userId: string;
  publicKey: string;
}

export class EncryptedSecretService {
  /**
   * Store encrypted secret for a user
   */
  public async storeEncryptedSecret(input: StoreEncryptedSecretInput) {
    try {
      const { userId, publicKey, encryptedSecret, iv, salt } = input;

      // Verify user exists
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Upsert encrypted secret (update if exists, create if not)
      const secret = await EncryptedSecret.findOneAndUpdate(
        { publicKey },
        {
          userId,
          publicKey,
          encryptedSecret,
          iv,
          salt,
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        }
      );

      logger.success(`✅ Encrypted secret stored for user ${userId}, publicKey: ${publicKey}`);
      return secret;
    } catch (err: any) {
      logger.error('❌ Failed to store encrypted secret:', err);
      throw err;
    }
  }

  /**
   * Get encrypted secret for a user
   */
  public async getEncryptedSecret(input: GetEncryptedSecretInput) {
    try {
      const { userId, publicKey } = input;

      const secret = await EncryptedSecret.findOne({ userId, publicKey });
      
      if (!secret) {
        return null;
      }

      return {
        encryptedSecret: secret.encryptedSecret,
        iv: secret.iv,
        salt: secret.salt,
      };
    } catch (err: any) {
      logger.error('❌ Failed to get encrypted secret:', err);
      throw err;
    }
  }

  /**
   * Check if user has stored secret
   */
  public async hasStoredSecret(input: GetEncryptedSecretInput): Promise<boolean> {
    try {
      const secret = await this.getEncryptedSecret(input);
      return secret !== null;
    } catch {
      return false;
    }
  }

  /**
   * Delete encrypted secret
   */
  public async deleteEncryptedSecret(input: GetEncryptedSecretInput) {
    try {
      const { userId, publicKey } = input;

      const result = await EncryptedSecret.deleteOne({ userId, publicKey });
      
      if (result.deletedCount === 0) {
        logger.warn(`No encrypted secret found to delete for user ${userId}, publicKey: ${publicKey}`);
      } else {
        logger.success(`✅ Encrypted secret deleted for user ${userId}, publicKey: ${publicKey}`);
      }

      return result;
    } catch (err: any) {
      logger.error('❌ Failed to delete encrypted secret:', err);
      throw err;
    }
  }

  /**
   * Store password attempts
   */
  public async storePasswordAttempts(userId: string, publicKey: string, attempts: number) {
    try {
      await PasswordAttempts.findOneAndUpdate(
        { publicKey },
        {
          userId,
          publicKey,
          attempts,
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        }
      );

      logger.info(`Password attempts stored: ${attempts} for user ${userId}, publicKey: ${publicKey}`);
    } catch (err: any) {
      logger.error('❌ Failed to store password attempts:', err);
      throw err;
    }
  }

  /**
   * Get password attempts
   */
  public async getPasswordAttempts(userId: string, publicKey: string): Promise<number> {
    try {
      const attempts = await PasswordAttempts.findOne({ userId, publicKey });
      return attempts?.attempts || 0;
    } catch (err: any) {
      logger.error('❌ Failed to get password attempts:', err);
      return 0; // Return 0 on error to allow retry
    }
  }

  /**
   * Reset password attempts
   */
  public async resetPasswordAttempts(userId: string, publicKey: string) {
    try {
      await PasswordAttempts.deleteOne({ userId, publicKey });
      logger.info(`Password attempts reset for user ${userId}, publicKey: ${publicKey}`);
    } catch (err: any) {
      logger.error('❌ Failed to reset password attempts:', err);
      throw err;
    }
  }

  /**
   * Check if account is locked
   */
  public async isAccountLocked(userId: string, publicKey: string): Promise<boolean> {
    const attempts = await this.getPasswordAttempts(userId, publicKey);
    return attempts >= 5; // Lock after 5 failed attempts
  }
}

