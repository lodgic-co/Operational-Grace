export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly messageParams?: Record<string, unknown>;

  constructor(opts: {
    status: number;
    code: string;
    message: string;
    retryable: boolean;
    messageParams?: Record<string, unknown>;
  }) {
    super(opts.message);
    this.name = 'AppError';
    this.status = opts.status;
    this.code = opts.code;
    this.retryable = opts.retryable;
    this.messageParams = opts.messageParams;
  }

  toEnvelope(requestId: string): ErrorEnvelope {
    const envelope: ErrorEnvelope = {
      error: {
        status: this.status,
        code: this.code,
        message: this.message,
        request_id: requestId,
        retryable: this.retryable,
      },
    };
    if (this.messageParams) {
      envelope.error.message_params = this.messageParams;
    }
    return envelope;
  }
}

export interface ErrorEnvelope {
  error: {
    status: number;
    code: string;
    message: string;
    message_params?: Record<string, unknown>;
    request_id: string;
    retryable: boolean;
  };
}

export function InvalidRequest(message: string, messageParams?: Record<string, unknown>): AppError {
  return new AppError({ status: 400, code: 'invalid_request', message, retryable: false, messageParams });
}

export function InvalidCursor(message: string): AppError {
  return new AppError({ status: 400, code: 'invalid_cursor', message, retryable: false });
}

export function Unauthenticated(message: string): AppError {
  return new AppError({ status: 401, code: 'unauthenticated', message, retryable: false });
}

export function NotFound(message: string = 'Not found'): AppError {
  return new AppError({ status: 404, code: 'not_found', message, retryable: false });
}

export function BadGateway(message: string = 'Upstream service unavailable'): AppError {
  return new AppError({ status: 502, code: 'bad_gateway', message, retryable: true });
}

export function InternalError(message: string = 'Internal server error'): AppError {
  return new AppError({ status: 500, code: 'internal_error', message, retryable: true });
}
