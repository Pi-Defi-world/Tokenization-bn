import chalk from 'chalk';

const getTimestamp = () => new Date().toISOString();

export const logger = {
  info: (msg: string) => console.log(`${chalk.blue('[INFO]')} ${chalk.gray(getTimestamp())} → ${msg}`),

  success: (msg: string) => console.log(`${chalk.green('[SUCCESS]')} ${chalk.gray(getTimestamp())} → ${msg}`),

  warn: (msg: string) => console.log(`${chalk.yellow('[WARN]')} ${chalk.gray(getTimestamp())} → ${msg}`),

  error: (msg: string, err?: any) => {
    console.log(`${chalk.red('[ERROR]')} ${chalk.gray(getTimestamp())} → ${msg}`);
    if (err) {
      // Properly serialize error objects
      if (err instanceof Error) {
        console.error(chalk.red(`  Message: ${err.message}`));
        if (err.stack) console.error(chalk.red(`  Stack: ${err.stack}`));
      } else if (typeof err === 'object') {
        try {
          console.error(chalk.red(JSON.stringify(err, null, 2)));
        } catch {
          console.error(chalk.red(String(err)));
        }
      } else {
        console.error(chalk.red(String(err)));
      }
    }
  },

  divider: () => console.log(chalk.cyan('----------------------------------------')),
};
