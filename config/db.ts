import mongoose from 'mongoose';
import env from './env';
import { logger } from '../utils/logger';

export const connectDB = async () => {
  const mongoURI = env.MONGO_URI;
  if (!mongoURI) {
    logger.error('MONGO_URI is not defined in environment variables');
    logger.error('Please check your .env file and ensure MONGO_URI is set');
    throw new Error('MONGO_URI is not defined in environment variables');
  }

  // Log connection attempt (without exposing credentials)
  const mongoURIMasked = mongoURI.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');
  logger.info(`Attempting to connect to MongoDB: ${mongoURIMasked}`);

  try {
    await mongoose.connect(mongoURI, {
      maxPoolSize: 50, // Maximum number of connections in the pool
      minPoolSize: 10, // Minimum number of connections to maintain
      maxIdleTimeMS: 30000, // Close connections after 30s of inactivity
      serverSelectionTimeoutMS: 30000, // Increased to 30s for better debugging
      socketTimeoutMS: 45000, // How long to wait for socket operations
      connectTimeoutMS: 30000, // Increased to 30s for better debugging
      // Note: bufferMaxEntries and bufferCommands are not available in Mongoose 8.x
      // Mongoose 8.x disables buffering by default when not connected
    });
    logger.success('MongoDB connected with optimized connection pool');
  } catch (error: any) {
    logger.error('MongoDB connection error:', error.message || error);
    
    // Provide helpful troubleshooting information
    if (error.message?.includes('timed out') || error.message?.includes('Server selection timed out')) {
      logger.error('Troubleshooting tips:');
      logger.error('1. Check if MongoDB server is running (if using local MongoDB)');
      logger.error('2. Verify MONGO_URI in your .env file is correct');
      logger.error('3. If using MongoDB Atlas, check:');
      logger.error('   - Your IP address is whitelisted in Network Access');
      logger.error('   - Database user credentials are correct');
      logger.error('   - Cluster is not paused');
      logger.error('4. Check your network/firewall settings');
    }
    
    process.exit(1);
  }
};
