import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import tokenRoutes from './routes/token.routes';
import { requestLogger } from './middlewares/logger-middleware';
import helmet from 'helmet';
import { logger } from './utils/logger';
import tomlRoutes from './routes/toml.routes';
import appRoutes from './routes';
import adminRoutes from './routes/admin.routes';
import { setupSwagger } from './config/swagger';
import { standardRateLimiter } from './middlewares/rateLimiter';
import { requestContext } from './middlewares/request-context';
import { securityMiddleware, corsSecurity } from './middlewares/security';
import { errorHandler, notFoundHandler } from './middlewares/error-handler';

dotenv.config();

const app = express();

// Security headers (Helmet)
app.use(helmet());

// CORS configuration
app.use(cors());

// Trust proxy for accurate IP addresses (important for rate limiting)
app.set('trust proxy', 1);

// Request context middleware (must be early - generates request ID)
app.use(requestContext);

// Security middleware (input sanitization, size validation, timeouts)
app.use(securityMiddleware);

// Additional CORS security headers
app.use(corsSecurity);

// Body parsing (must come after security middleware)
app.use(express.json({ limit: '10mb' })); // Limit request body size
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting (after body parsing, before routes)
app.use(standardRateLimiter);

// Request logger (development only)
if (process.env.NODE_ENV !== 'production') {
  app.use(requestLogger);
}

// Swagger documentation
setupSwagger(app);

// Health check route
app.get('/', (req, res) => {
  res.send({ message: '🚀 Pi DeFi Backend is running' });
});

// API routes
app.use('/v1', appRoutes);

// Admin routes (requires authentication and admin role)
app.use('/v1/admin', adminRoutes);

// Pi Wallet expects pi.toml at /.well-known/pi.toml (not stellar.toml)
app.get('/.well-known/pi.toml', tomlRoutes);

// 404 handler for unmatched routes (must come before error handler)
app.use(notFoundHandler);

// Error handling middleware (must be last)
app.use(errorHandler);

export default app;
