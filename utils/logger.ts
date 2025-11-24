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

/**
 * Simplify Axios response/error objects for cleaner logging
 */
const simplifyAxiosObject = (obj: any): any => {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  // Handle Axios response
  if (obj.status && obj.statusText && obj.data !== undefined) {
    return {
      status: obj.status,
      statusText: obj.statusText,
      data: obj.data,
      url: obj.config?.url || obj.request?.path || 'unknown',
      method: obj.config?.method?.toUpperCase() || 'unknown',
    };
  }

  // Handle Axios error
  if (obj.response) {
    const simplified: any = {
      message: obj.message || 'Request failed',
      status: obj.response.status,
      statusText: obj.response.statusText,
      url: obj.config?.url || obj.request?.path || 'unknown',
      method: obj.config?.method?.toUpperCase() || 'unknown',
    };

    // Include error data if it's small and meaningful
    if (obj.response.data) {
      if (typeof obj.response.data === 'string' && obj.response.data.length < 200) {
        simplified.data = obj.response.data;
      } else if (typeof obj.response.data === 'object') {
        // Only include essential error fields
        if (obj.response.data.type) simplified.type = obj.response.data.type;
        if (obj.response.data.title) simplified.title = obj.response.data.title;
        if (obj.response.data.detail) simplified.detail = obj.response.data.detail;
        if (obj.response.data.extras) {
          simplified.extras = {
            invalid_field: obj.response.data.extras.invalid_field,
            reason: obj.response.data.extras.reason,
            result_codes: obj.response.data.extras.result_codes,
          };
        }
        if (obj.response.data.message) simplified.message = obj.response.data.message;
      }
    }

    return simplified;
  }

  // Handle regular Error objects
  if (obj instanceof Error) {
    return {
      message: obj.message,
      name: obj.name,
      ...(isDevelopment && obj.stack ? { stack: obj.stack.split('\n').slice(0, 3).join('\n') } : {}),
    };
  }

  // For other objects, try to extract meaningful fields
  const simplified: any = {};
  const importantKeys = ['message', 'error', 'code', 'status', 'statusCode', 'type', 'title', 'detail'];
  
  for (const key of importantKeys) {
    if (obj[key] !== undefined) {
      simplified[key] = obj[key];
    }
  }

  // If no important keys found, return a summary
  if (Object.keys(simplified).length === 0) {
    return { type: typeof obj, keys: Object.keys(obj).slice(0, 10) };
  }

  return simplified;
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
        // Simplify Axios responses/errors for cleaner logs
        const simplified = simplifyAxiosObject(err);
        try {
          console.error(chalk.red(JSON.stringify(simplified, null, isDevelopment ? 2 : 0)));
        } catch {
          // Fallback if JSON.stringify fails
          if (err instanceof Error) {
            console.error(chalk.red(`  Message: ${err.message}`));
          } else {
            console.error(chalk.red(String(err)));
          }
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
