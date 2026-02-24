import mongoose from 'mongoose';
import env from './env';
import { logger } from '../utils/logger';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

export const connectDB = async (): Promise<void> => {
  const mongoURI = env.MONGO_URI;
  if (!mongoURI) {
    logger.error('MONGO_URI is not defined in environment variables');
    logger.error('Please check your .env file and ensure MONGO_URI is set');
    throw new Error('MONGO_URI is not defined in environment variables');
  }

  const mongoURIMasked = mongoURI.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');
  logger.info(`Attempting to connect to MongoDB: ${mongoURIMasked}`);

  const connectOptions = {
    maxPoolSize: 50,
    minPoolSize: 10,
    maxIdleTimeMS: 30000,
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 30000,
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await mongoose.connect(mongoURI, connectOptions);
      logger.success('MongoDB connected');
      return;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`MongoDB connection error (attempt ${attempt}/${MAX_RETRIES}):`, message);

      if (attempt === MAX_RETRIES) {
        logger.error(
          'Could not connect after retries. Check: (1) MONGO_URI in .env, (2) network/firewall, (3) MongoDB Atlas cluster is running and not paused.'
        );
        process.exit(1);
      }

      logger.error(`Retrying in ${RETRY_DELAY_MS / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
};
