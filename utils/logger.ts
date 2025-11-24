import chalk from 'chalk';

const getTimestamp = () => new Date().toISOString();
const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = process.env.NODE_ENV === 'development';

// In production, reduce logging verbosity for performance
const shouldLog = (level: 'info' | 'warn' | 'error' | 'success') => {
  if (isProduction) {
    // In production, only log warnings and errors
    return level === 'warn' || level === 'error' || level === 'success';
  }
  return true;
};

export const logger = {
  info: (msg: string) => {
    if (shouldLog('info')) {
      console.log(`${chalk.blue('[INFO]')} ${chalk.gray(getTimestamp())} → ${msg}`);
    }
  },

  success: (msg: string) => {
    if (shouldLog('success')) {
      console.log(`${chalk.green('[SUCCESS]')} ${chalk.gray(getTimestamp())} → ${msg}`);
    }
  },

  warn: (msg: string) => {
    if (shouldLog('warn')) {
      console.log(`${chalk.yellow('[WARN]')} ${chalk.gray(getTimestamp())} → ${msg}`);
    }
  },

  error: (msg: string, err?: any) => {
    if (shouldLog('error')) {
      console.log(`${chalk.red('[ERROR]')} ${chalk.gray(getTimestamp())} → ${msg}`);
      if (err) {
        // Properly serialize error objects
        if (err instanceof Error) {
          console.error(chalk.red(`  Message: ${err.message}`));
          if (err.stack && isDevelopment) {
            console.error(chalk.red(`  Stack: ${err.stack}`));
          }
        } else if (typeof err === 'object') {
          try {
            console.error(chalk.red(JSON.stringify(err, null, isDevelopment ? 2 : 0)));
          } catch {
            console.error(chalk.red(String(err)));
          }
        } else {
          console.error(chalk.red(String(err)));
        }
      }
    }
  },

  divider: () => {
    if (!isProduction) {
      console.log(chalk.cyan('----------------------------------------'));
    }
  },
};
