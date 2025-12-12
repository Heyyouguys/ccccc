/**
 * 统一日志工具库
 * 
 * 功能：
 * 1. 在开发环境输出调试日志，生产环境静默
 * 2. 支持不同日志级别：debug, info, warn, error
 * 3. 支持命名空间/模块标签
 * 4. 支持条件日志（仅在特定条件下输出）
 * 
 * 使用示例：
 * ```typescript
 * import { createLogger, logger } from '@/lib/logger';
 * 
 * // 使用全局 logger
 * logger.debug('调试信息');
 * logger.info('普通信息');
 * logger.warn('警告信息');
 * logger.error('错误信息');
 * 
 * // 创建带命名空间的 logger
 * const log = createLogger('SearchModule');
 * log.debug('搜索变体', { query, variants });
 * ```
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerOptions {
  /** 命名空间/模块名称 */
  namespace?: string;
  /** 是否强制启用（忽略环境检测） */
  forceEnable?: boolean;
  /** 最小日志级别 */
  minLevel?: LogLevel;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * 检查是否为开发环境
 */
function isDevelopment(): boolean {
  // 服务端环境检测
  if (typeof process !== 'undefined' && process.env) {
    return process.env.NODE_ENV === 'development';
  }
  // 客户端环境检测
  if (typeof window !== 'undefined') {
    // Next.js 客户端会注入这个变量
    return (window as { __NEXT_DATA__?: { runtimeConfig?: { NODE_ENV?: string } } }).__NEXT_DATA__?.runtimeConfig?.NODE_ENV === 'development' ||
           window.location?.hostname === 'localhost' ||
           window.location?.hostname === '127.0.0.1';
  }
  return false;
}

/**
 * 检查是否启用调试日志
 * 可通过环境变量 DEBUG_LOG=true 强制启用
 */
function isDebugEnabled(): boolean {
  if (typeof process !== 'undefined' && process.env) {
    return process.env.DEBUG_LOG === 'true';
  }
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    return localStorage.getItem('DEBUG_LOG') === 'true';
  }
  return false;
}

/**
 * 格式化日志前缀
 */
function formatPrefix(level: LogLevel, namespace?: string): string {
  const timestamp = new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
  const levelTag = level.toUpperCase().padEnd(5);
  const nsTag = namespace ? `[${namespace}]` : '';
  return `${timestamp} ${levelTag} ${nsTag}`.trim();
}

/**
 * 创建 Logger 实例
 */
class Logger {
  private namespace?: string;
  private forceEnable: boolean;
  private minLevel: LogLevel;

  constructor(options: LoggerOptions = {}) {
    this.namespace = options.namespace;
    this.forceEnable = options.forceEnable ?? false;
    this.minLevel = options.minLevel ?? 'debug';
  }

  private shouldLog(level: LogLevel): boolean {
    // 检查日志级别
    if (LOG_LEVELS[level] < LOG_LEVELS[this.minLevel]) {
      return false;
    }

    // error 和 warn 级别始终输出
    if (level === 'error' || level === 'warn') {
      return true;
    }

    // 强制启用时始终输出
    if (this.forceEnable) {
      return true;
    }

    // 检查调试模式
    if (isDebugEnabled()) {
      return true;
    }

    // 仅在开发环境输出 debug 和 info
    return isDevelopment();
  }

  /**
   * 调试级别日志 - 仅开发环境输出
   */
  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.log(formatPrefix('debug', this.namespace), message, ...args);
    }
  }

  /**
   * 信息级别日志 - 仅开发环境输出
   */
  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.info(formatPrefix('info', this.namespace), message, ...args);
    }
  }

  /**
   * 警告级别日志 - 始终输出
   */
  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(formatPrefix('warn', this.namespace), message, ...args);
    }
  }

  /**
   * 错误级别日志 - 始终输出
   */
  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(formatPrefix('error', this.namespace), message, ...args);
    }
  }

  /**
   * 条件日志 - 仅当条件为真时输出
   */
  debugIf(condition: boolean, message: string, ...args: unknown[]): void {
    if (condition) {
      this.debug(message, ...args);
    }
  }

  /**
   * 创建子 Logger，继承父级配置并添加子命名空间
   */
  child(childNamespace: string): Logger {
    const newNamespace = this.namespace 
      ? `${this.namespace}:${childNamespace}` 
      : childNamespace;
    return new Logger({
      namespace: newNamespace,
      forceEnable: this.forceEnable,
      minLevel: this.minLevel,
    });
  }
}

/**
 * 创建带命名空间的 Logger
 */
export function createLogger(namespace: string, options: Omit<LoggerOptions, 'namespace'> = {}): Logger {
  return new Logger({ ...options, namespace });
}

/**
 * 全局默认 Logger 实例
 */
export const logger = new Logger();

/**
 * 预定义的模块 Logger
 */
export const loggers = {
  search: createLogger('Search'),
  douban: createLogger('Douban'),
  cache: createLogger('Cache'),
  api: createLogger('API'),
  ui: createLogger('UI'),
  db: createLogger('DB'),
  auth: createLogger('Auth'),
} as const;

export default logger;