
import app from './app';
import { connectDB } from './config/db';
import env from './config/env';
import { logger } from './utils/logger';

const PORT = env.PORT;

const startServer = () => {
  try {
    
    app.listen(PORT, async() => {
      logger.success(`🚀 Pi DeFi backend running on port ${PORT}`);
      await connectDB();
    });
  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

