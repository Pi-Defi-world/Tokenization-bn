import mongoose from 'mongoose';
import env from '../config/env';
import { logger } from '../utils/logger';
import Passkey from '../models/Passkey';
import User from '../models/User';

/**
 * Database initialization script
 * Ensures all collections and indexes are properly set up
 */
export const initializeDatabase = async () => {
  try {
    const mongoURI = env.MONGO_URI;
    if (!mongoURI) {
      throw new Error('MONGO_URI is not defined in environment variables');
    }

    // Connect to MongoDB
    await mongoose.connect(mongoURI);
    logger.info('Connected to MongoDB for initialization');

    // Ensure Passkey collection exists and indexes are created
    const passkeyCollection = mongoose.connection.collection('passkeys');
    const passkeyIndexes = await passkeyCollection.indexes();
    logger.info(`Passkey collection indexes: ${passkeyIndexes.length} found`);

    // Create indexes if they don't exist (Mongoose will handle this automatically, but we verify)
    await Passkey.createIndexes();
    logger.success('Passkey indexes created/verified');

    // Verify User collection has public_key field
    const userCollection = mongoose.connection.collection('users');
    const userIndexes = await userCollection.indexes();
    logger.info(`User collection indexes: ${userIndexes.length} found`);

    // Ensure public_key index exists on User model
    await User.createIndexes();
    logger.success('User indexes created/verified');

    logger.success('Database initialization completed');
  } catch (error: any) {
    logger.error('Database initialization error:', error.message || error);
    throw error;
  }
};

// Run if called directly
if (require.main === module) {
  initializeDatabase()
    .then(() => {
      logger.success('Database initialization script completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Database initialization script failed:', error);
      process.exit(1);
    });
}

