import { Request, Response, NextFunction } from 'express';
import chalk from 'chalk';
import { logger } from '../utils/logger';

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();

  logger.info(chalk.bgBlue.bold('------------------------ START ---------------------------------'));
  logger.info(`${chalk.cyan(req.method)} ${req.originalUrl}`);

  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusColor =
      res.statusCode >= 500
        ? chalk.red
        : res.statusCode >= 400
        ? chalk.yellow
        : chalk.green;

    const msg = `${chalk.cyan(req.method)} ${req.originalUrl} → ${statusColor(
      res.statusCode
    )} (${duration}ms)`;
    
    logger.info(msg);
    logger.info(chalk.bgMagenta.bold('------------------------- FINISH -------------------------------'));
  });

  next();
};
