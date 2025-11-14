import mongoose from 'mongoose';
import env from './env';
import { logger } from '../utils/logger';
import Passkey from '../models/Passkey';

export const connectDB = async () => {
  const mongoURI = env.MONGO_URI;
  if (!mongoURI) {
    throw new Error('MONGO_URI is not defined in environment variables');
  }

  try {
    await mongoose.connect(mongoURI);
    logger.success('MongoDB connected');
    
    // Ensure Passkey model indexes are created
    try {
      await Passkey.createIndexes();
      logger.info('Passkey collection indexes verified');
    } catch (indexError: any) {
      logger.warn(`Passkey index creation warning: ${indexError.message}`);
      // Don't fail connection if index creation has issues (might already exist)
    }
  } catch (error: any) {
    logger.error('MongoDB connection error:', error.message || error);
    process.exit(1);
  }
};
