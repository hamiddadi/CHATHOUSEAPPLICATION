import { createLogger, format, transports } from 'winston';
import { env } from './env';

const jsonFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  format.json(),
);

const devFormat = format.combine(
  format.colorize(),
  format.timestamp({ format: 'HH:mm:ss' }),
  format.printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `${String(timestamp)} ${level} ${String(stack ?? message)}${metaStr}`;
  }),
);

/**
 * App-wide logger. Structured JSON in production (ready for ELK/CloudWatch),
 * human-readable colourised output in dev/test.
 */
export const logger = createLogger({
  level: env.LOG_LEVEL,
  format: env.NODE_ENV === 'production' ? jsonFormat : devFormat,
  transports: [new transports.Console()],
  exitOnError: false,
});
