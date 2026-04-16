export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Anything serializable as JSON works as log meta. */
export type LogMeta = Record<string, unknown> | object;

export interface Logger {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
  child(bindings: LogMeta): Logger;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};
const COLOR_RESET = '\x1b[0m';

export interface ConsoleLoggerOptions {
  level?: LogLevel;
  bindings?: LogMeta;
}

const DEFAULT_LEVEL: LogLevel = 'info';

export class ConsoleLogger implements Logger {
  private readonly level: LogLevel;
  private readonly minPriority: number;
  private readonly bindings: LogMeta;

  constructor(options: ConsoleLoggerOptions = {}) {
    this.level = options.level ?? DEFAULT_LEVEL;
    this.minPriority = LEVEL_PRIORITY[this.level];
    this.bindings = options.bindings ?? {};
  }

  private write(level: LogLevel, message: string, meta?: LogMeta): void {
    if (LEVEL_PRIORITY[level] < this.minPriority) return;
    const merged = { ...this.bindings, ...meta };
    const metaStr = Object.keys(merged).length > 0 ? ` ${JSON.stringify(merged)}` : '';
    const time = new Date().toISOString();
    const line = `${LEVEL_COLORS[level]}[${time}] ${level.toUpperCase()}${COLOR_RESET} ${message}${metaStr}`;
    if (level === 'error') {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  debug(message: string, meta?: LogMeta): void {
    this.write('debug', message, meta);
  }
  info(message: string, meta?: LogMeta): void {
    this.write('info', message, meta);
  }
  warn(message: string, meta?: LogMeta): void {
    this.write('warn', message, meta);
  }
  error(message: string, meta?: LogMeta): void {
    this.write('error', message, meta);
  }

  child(bindings: LogMeta): Logger {
    return new ConsoleLogger({
      level: this.level,
      bindings: { ...this.bindings, ...bindings },
    });
  }
}

export function createLogger(options?: ConsoleLoggerOptions): Logger {
  return new ConsoleLogger(options);
}
