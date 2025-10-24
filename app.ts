import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import tokenRoutes from './routes/token.routes';
import { requestLogger } from './middlewares/logger-middleware';
import helmet from 'helmet';
import { logger } from './utils/logger';
import tomlRoutes from './routes/toml.routes';
import appRoutes from './routes';

dotenv.config();

const app = express();
app.use(helmet());
app.use(cors());
app.use(bodyParser.json()); 
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(requestLogger); 

app.get('/', (req, res) => {
    res.send({ message: '🚀 Pi DeFi Backend is running' });
  });

app.use('/v1', appRoutes);

app.get('/:assetCode/.well-known/stellar.toml', tomlRoutes);

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error('Unhandled Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  });

export default app;
