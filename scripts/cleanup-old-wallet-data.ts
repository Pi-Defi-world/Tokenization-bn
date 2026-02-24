import mongoose from 'mongoose';
import env from '../config/env';
import { logger } from '../utils/logger';
import User from '../models/User';

/**
 * Migration script to clean up old wallet and encryption data
 * This script:
 * 1. Clears all public_key fields from User documents (from old import/encryption system)
 * 2. Drops the Passkey collection (old passkey authentication)
 * 3. Drops the PasswordAttempts collection (old password authentication)
 * 4. Drops the EncryptedSecret collection if it exists (old encryption system)
 */
export const cleanupOldWalletData = async () => {
  try {
    const mongoURI = env.MONGO_URI;
    if (!mongoURI) {
      throw new Error('MONGO_URI is not defined in environment variables');
    }

    // Connect to MongoDB
    await mongoose.connect(mongoURI);
    logger.info('Connected to MongoDB for cleanup migration');

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Database connection not available');
    }

 
    logger.info('Dropping public_key unique index temporarily...');
    try {
      const userCollection = db.collection('users');
      await userCollection.dropIndex('public_key_1');
      logger.success('Dropped public_key_1 index');
    } catch (error: any) {
      if (error.codeName === 'IndexNotFound') {
        logger.info('public_key_1 index does not exist, skipping');
      } else {
        logger.warn(`Could not drop index (may not exist): ${error.message}`);
      }
    }

    // 2. Clear all public_key fields from User documents using $unset (removes field entirely)
    logger.info('Clearing public_key fields from User documents...');
    const userUpdateResult = await User.updateMany(
      { 
        public_key: { $exists: true, $nin: [null, ''] }
      },
      { $unset: { public_key: '' } }
    );
    logger.success(`Cleared public_key from ${userUpdateResult.modifiedCount} user(s)`);

    // 3. Recreate the unique sparse index on public_key
    logger.info('Recreating public_key unique index...');
    try {
      const userCollection = db.collection('users');
      await userCollection.createIndex({ public_key: 1 }, { unique: true, sparse: true });
      logger.success('Recreated public_key_1 index');
    } catch (error: any) {
      logger.warn(`Could not recreate index: ${error.message}`);
    }

    // 4. Drop Passkey collection
    logger.info('Dropping Passkey collection...');
    try {
      const passkeyCollection = db.collection('passkeys');
      const passkeyCount = await passkeyCollection.countDocuments();
      await passkeyCollection.drop();
      logger.success(`Dropped Passkey collection (${passkeyCount} documents removed)`);
    } catch (error: any) {
      if (error.codeName === 'NamespaceNotFound') {
        logger.info('Passkey collection does not exist, skipping');
      } else {
        throw error;
      }
    }

    // 5. Drop PasswordAttempts collection
    logger.info('Dropping PasswordAttempts collection...');
    try {
      const passwordAttemptsCollection = db.collection('passwordattempts');
      const passwordAttemptsCount = await passwordAttemptsCollection.countDocuments();
      await passwordAttemptsCollection.drop();
      logger.success(`Dropped PasswordAttempts collection (${passwordAttemptsCount} documents removed)`);
    } catch (error: any) {
      if (error.codeName === 'NamespaceNotFound') {
        logger.info('PasswordAttempts collection does not exist, skipping');
      } else {
        throw error;
      }
    }

    // 6. Drop EncryptedSecret collection if it exists
    logger.info('Dropping EncryptedSecret collection (if exists)...');
    try {
      const encryptedSecretCollection = db.collection('encryptedsecrets');
      const encryptedSecretCount = await encryptedSecretCollection.countDocuments();
      await encryptedSecretCollection.drop();
      logger.success(`Dropped EncryptedSecret collection (${encryptedSecretCount} documents removed)`);
    } catch (error: any) {
      if (error.codeName === 'NamespaceNotFound') {
        logger.info('EncryptedSecret collection does not exist, skipping');
      } else {
        throw error;
      }
    }

    // Also try alternative collection name (case variations)
    const alternativeNames = ['EncryptedSecret', 'encrypted_secrets', 'encrypted-secrets'];
    for (const collectionName of alternativeNames) {
      try {
        const collection = db.collection(collectionName);
        const count = await collection.countDocuments();
        if (count > 0) {
          await collection.drop();
          logger.success(`Dropped ${collectionName} collection (${count} documents removed)`);
        }
      } catch (error: any) {
        if (error.codeName !== 'NamespaceNotFound') {
          logger.warn(`Error checking ${collectionName}: ${error.message}`);
        }
      }
    }

    logger.success('✅ Cleanup migration completed successfully');
    logger.info('All old wallet and encryption data has been cleared');
    logger.info('Users can now create new wallets using the new wallet creation system');

  } catch (error: any) {
    logger.error('Cleanup migration error:', error.message || error);
    throw error;
  } finally {
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB');
  }
};

// Run if called directly
if (require.main === module) {
  cleanupOldWalletData()
    .then(() => {
      logger.success('Cleanup migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Cleanup migration script failed:', error);
      process.exit(1);
    });
}

