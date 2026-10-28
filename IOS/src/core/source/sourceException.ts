/**
 * Android source: `com.example.source.SourceException.kt`
 * Kotlin sealed class → TS class hierarchy (instanceof checks preserved).
 */

export class SourceException extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'SourceException';
  }
}

/** Kotlin `object LoginRequired` — "需要登录后继续操作". */
export class LoginRequired extends SourceException {
  constructor() {
    super('需要登录后继续操作');
    this.name = 'LoginRequired';
  }
}

/**
 * Kotlin `data class NetworkError(val errorMsg: String, val throwable: Throwable? = null)`.
 * `errorMsg` is also the `Exception.message`; both names are kept because the Kotlin data
 * class exposes the property, and `message` is what every consumer actually reads.
 */
export class NetworkError extends SourceException {
  readonly errorMsg: string;
  readonly throwable: unknown;

  constructor(errorMsg: string, throwable?: unknown) {
    super(errorMsg, throwable);
    this.name = 'NetworkError';
    this.errorMsg = errorMsg;
    this.throwable = throwable;
  }
}

/** Kotlin `data class ParseError(val errorMsg: String)`. */
export class ParseError extends SourceException {
  readonly errorMsg: string;

  constructor(errorMsg: string) {
    super(errorMsg);
    this.name = 'ParseError';
    this.errorMsg = errorMsg;
  }
}

/** Kotlin `object BookNotFound` — "未能找到对应图书". */
export class BookNotFound extends SourceException {
  constructor() {
    super('未能找到对应图书');
    this.name = 'BookNotFound';
  }
}

/** Kotlin `data class Unknown(val errorMsg: String, val throwable: Throwable? = null)`. */
export class Unknown extends SourceException {
  readonly errorMsg: string;
  readonly throwable: unknown;

  constructor(errorMsg: string, throwable?: unknown) {
    super(errorMsg, throwable);
    this.name = 'Unknown';
    this.errorMsg = errorMsg;
    this.throwable = throwable;
  }
}
