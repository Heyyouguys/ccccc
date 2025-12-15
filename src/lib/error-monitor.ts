/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 错误监控工具
 * 用于统一处理和上报应用错误
 */

export interface ErrorContext {
  context: string;
  metadata?: Record<string, any>;
  userId?: string;
  timestamp?: number;
}

export interface ErrorReport {
  message: string;
  stack?: string;
  context: string;
  metadata?: Record<string, any>;
  userId?: string;
  timestamp: number;
  level: 'error' | 'warning' | 'info';
}

// 错误级别
export enum ErrorLevel {
  ERROR = 'error',
  WARNING = 'warning',
  INFO = 'info',
}

/**
 * 记录错误到控制台（开发环境）或发送到监控服务（生产环境）
 */
export function logError(
  error: Error | string,
  context: ErrorContext,
  level: ErrorLevel = ErrorLevel.ERROR
): void {
  const errorMessage = error instanceof Error ? error.message : error;
  const errorStack = error instanceof Error ? error.stack : undefined;

  const report: ErrorReport = {
    message: errorMessage,
    stack: errorStack,
    context: context.context,
    metadata: context.metadata,
    userId: context.userId,
    timestamp: context.timestamp || Date.now(),
    level,
  };

  // 开发环境：输出到控制台
  if (process.env.NODE_ENV === 'development') {
    console.error(`[${level.toUpperCase()}] ${context.context}:`, report);
    return;
  }

  // 生产环境：发送到监控服务
  // 这里可以集成 Sentry、LogRocket 等服务
  sendToMonitoringService(report);
}

/**
 * 发送错误报告到监控服务
 */
function sendToMonitoringService(report: ErrorReport): void {
  // TODO: 集成实际的监控服务
  // 例如 Sentry:
  // if (typeof window !== 'undefined' && window.Sentry) {
  //   window.Sentry.captureException(new Error(report.message), {
  //     extra: report.metadata,
  //     level: report.level,
  //   });
  // }

  // 暂时只在控制台输出
  console.error('[Error Monitor]', report);
}

/**
 * 包装异步函数以自动捕获错误
 */
export function withErrorHandler<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  context: string
): T {
  return (async (...args: any[]) => {
    try {
      return await fn(...args);
    } catch (error) {
      logError(
        error instanceof Error ? error : new Error(String(error)),
        { context, metadata: { args } }
      );
      throw error;
    }
  }) as T;
}

/**
 * API 错误处理工具
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public context: string,
    public metadata?: Record<string, any>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * 统一的 API 错误处理
 */
export function handleApiError(
  error: unknown,
  context: string,
  metadata?: Record<string, any>
): { error: string; statusCode: number } {
  if (error instanceof ApiError) {
    logError(error, { context, metadata: { ...metadata, statusCode: error.statusCode } });
    return { error: error.message, statusCode: error.statusCode };
  }

  if (error instanceof Error) {
    logError(error, { context, metadata });
    return { error: error.message, statusCode: 500 };
  }

  const errorMsg = String(error);
  logError(errorMsg, { context, metadata });
  return { error: errorMsg, statusCode: 500 };
}

/**
 * 网络请求错误处理
 */
export function handleFetchError(
  error: unknown,
  url: string,
  context: string
): never {
  const metadata = { url };
  
  if (error instanceof Error) {
    logError(error, { context, metadata });
    throw new ApiError(
      `网络请求失败: ${error.message}`,
      0,
      context,
      metadata
    );
  }

  const errorMsg = String(error);
  logError(errorMsg, { context, metadata });
  throw new ApiError(`网络请求失败: ${errorMsg}`, 0, context, metadata);
}