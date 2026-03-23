/**
 * Error classification taxonomy for provider failures.
 *
 * Maps HTTP status codes and error signatures to error classes with
 * prescribed recovery strategies. Used by the resilience tracker
 * and backoff manager to apply class-specific handling.
 */

export type ErrorClass = "rate_limit" | "server_error" | "auth" | "timeout" | "client_error" | "network" | "unknown";

export interface ClassifiedError {
  errorClass: ErrorClass;
  httpCode: number | null;
  retryable: boolean;
  message: string;
}

/** Recovery strategy associated with each error class. */
export interface RecoveryStrategy {
  errorClass: ErrorClass;
  retry: boolean;
  /** Use global backoff (pause all dispatches to this provider). */
  globalPause: boolean;
  /** Use circuit breaker escalation. */
  circuitBreaker: boolean;
  /** Hard fail with no retry. */
  hardFail: boolean;
  /** Suggested delay before retry, in milliseconds. Null means use backoff manager. */
  suggestedDelayMs: number | null;
}

const STRATEGY_TABLE: Record<ErrorClass, RecoveryStrategy> = {
  rate_limit: {
    errorClass: "rate_limit",
    retry: true,
    globalPause: true,
    circuitBreaker: false,
    hardFail: false,
    suggestedDelayMs: 30_000,
  },
  server_error: {
    errorClass: "server_error",
    retry: true,
    globalPause: false,
    circuitBreaker: true,
    hardFail: false,
    suggestedDelayMs: null,
  },
  auth: {
    errorClass: "auth",
    retry: false,
    globalPause: false,
    circuitBreaker: false,
    hardFail: true,
    suggestedDelayMs: null,
  },
  timeout: {
    errorClass: "timeout",
    retry: true,
    globalPause: false,
    circuitBreaker: true,
    hardFail: false,
    suggestedDelayMs: 5_000,
  },
  client_error: {
    errorClass: "client_error",
    retry: false,
    globalPause: false,
    circuitBreaker: false,
    hardFail: true,
    suggestedDelayMs: null,
  },
  network: {
    errorClass: "network",
    retry: true,
    globalPause: false,
    circuitBreaker: true,
    hardFail: false,
    suggestedDelayMs: 2_000,
  },
  unknown: {
    errorClass: "unknown",
    retry: false,
    globalPause: false,
    circuitBreaker: false,
    hardFail: true,
    suggestedDelayMs: null,
  },
};

/**
 * Classify an error from its HTTP status code.
 */
export function classifyHttpError(httpCode: number, message?: string): ClassifiedError {
  const msg = message ?? `HTTP ${httpCode}`;

  if (httpCode === 429) {
    return { errorClass: "rate_limit", httpCode, retryable: true, message: msg };
  }
  if (httpCode === 401 || httpCode === 403) {
    return { errorClass: "auth", httpCode, retryable: false, message: msg };
  }
  if (httpCode === 408 || httpCode === 504) {
    return { errorClass: "timeout", httpCode, retryable: true, message: msg };
  }
  if (httpCode >= 500) {
    return { errorClass: "server_error", httpCode, retryable: true, message: msg };
  }
  if (httpCode >= 400) {
    return { errorClass: "client_error", httpCode, retryable: false, message: msg };
  }

  return { errorClass: "unknown", httpCode, retryable: false, message: msg };
}

/**
 * Classify an error from its error message string.
 * Used for CLI runtime errors where no HTTP code is available.
 */
export function classifyErrorMessage(message: string): ClassifiedError {
  const lower = message.toLowerCase();

  if (lower.includes("rate limit") || lower.includes("429") || lower.includes("too many requests")) {
    return { errorClass: "rate_limit", httpCode: 429, retryable: true, message };
  }
  if (lower.includes("unauthorized") || lower.includes("401") || lower.includes("invalid api key")) {
    return { errorClass: "auth", httpCode: 401, retryable: false, message };
  }
  if (lower.includes("forbidden") || lower.includes("403")) {
    return { errorClass: "auth", httpCode: 403, retryable: false, message };
  }
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("504") || lower.includes("408")) {
    return { errorClass: "timeout", httpCode: null, retryable: true, message };
  }
  if (
    lower.includes("500") ||
    lower.includes("internal server error") ||
    lower.includes("502") ||
    lower.includes("503")
  ) {
    return { errorClass: "server_error", httpCode: null, retryable: true, message };
  }
  if (
    lower.includes("econnrefused") ||
    lower.includes("econnreset") ||
    lower.includes("enotfound") ||
    lower.includes("network")
  ) {
    return { errorClass: "network", httpCode: null, retryable: true, message };
  }

  return { errorClass: "unknown", httpCode: null, retryable: false, message };
}

/**
 * Get the recovery strategy for an error class.
 */
export function getRecoveryStrategy(errorClass: ErrorClass): RecoveryStrategy {
  return STRATEGY_TABLE[errorClass];
}

/**
 * Determine the appropriate recovery strategy for a classified error.
 */
export function strategyForError(error: ClassifiedError): RecoveryStrategy {
  return STRATEGY_TABLE[error.errorClass];
}
