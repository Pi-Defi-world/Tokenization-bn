import mongoose from 'mongoose';
import env from './env';
import { logger } from '../utils/logger';

export const connectDB = async () => {
  const mongoURI = env.MONGO_URI;
  if (!mongoURI) {
    throw new Error('MONGO_URI is not defined in environment variables');
  }

  try {
    await mongoose.connect(mongoURI, {
      maxPoolSize: 50, // Maximum number of connections in the pool
      minPoolSize: 10, // Minimum number of connections to maintain
      maxIdleTimeMS: 30000, // Close connections after 30s of inactivity
      serverSelectionTimeoutMS: 5000, // How long to wait for server selection
      socketTimeoutMS: 45000, // How long to wait for socket operations
      connectTimeoutMS: 10000, // How long to wait for initial connection
      // Note: bufferMaxEntries and bufferCommands are not available in Mongoose 8.x
      // Mongoose 8.x disables buffering by default when not connected
    });
    logger.success('MongoDB connected with optimized connection pool');
  } catch (error: any) {
    logger.error('MongoDB connection error:', error.message || error);
    process.exit(1);
  }
};
