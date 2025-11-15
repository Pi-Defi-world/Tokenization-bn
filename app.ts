import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import tokenRoutes from './routes/token.routes';
import { requestLogger } from './middlewares/logger-middleware';
import helmet from 'helmet';
import { logger } from './utils/logger';
import tomlRoutes from './routes/toml.routes';
import appRoutes from './routes';
import { setupSwagger } from './config/swagger';

dotenv.config();

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger); 

setupSwagger(app);

app.get('/', (req, res) => {
    res.send({ message: '🚀 Pi DeFi Backend is running' });
  });

app.use('/v1', appRoutes);

// Pi Wallet expects pi.toml at /.well-known/pi.toml (not stellar.toml)
app.get('/.well-known/pi.toml', tomlRoutes);

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error('Unhandled Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  });

export default app;
