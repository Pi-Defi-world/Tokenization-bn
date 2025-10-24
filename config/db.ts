import mongoose from 'mongoose';
import env from './env';
import { logger } from '../utils/logger';

export const connectDB = async () => {
  const mongoURI = env.MONGO_URI;
  if (!mongoURI) {
    throw new Error('MONGO_URI is not defined in environment variables');
  }

  try {
    await mongoose.connect(mongoURI);
    logger.success('MongoDB connected');
  } catch (error: any) {
    logger.error('MongoDB connection error:', error.message || error);
    process.exit(1);
  }
};
