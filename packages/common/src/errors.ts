import { HttpStatus } from './http-status';

export class HopakError extends Error {
  readonly status: number = HttpStatus.InternalServerError;
  readonly code: string = 'INTERNAL_ERROR';
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
  }

  toJSON() {
    return {
      error: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export class ValidationError extends HopakError {
  override readonly status = HttpStatus.BadRequest;
  override readonly code = 'VALIDATION_ERROR';
}

export class Unauthorized extends HopakError {
  override readonly status = HttpStatus.Unauthorized;
  override readonly code = 'UNAUTHORIZED';
}

export class Forbidden extends HopakError {
  override readonly status = HttpStatus.Forbidden;
  override readonly code = 'FORBIDDEN';
}

export class NotFound extends HopakError {
  override readonly status = HttpStatus.NotFound;
  override readonly code = 'NOT_FOUND';
}

export class Conflict extends HopakError {
  override readonly status = HttpStatus.Conflict;
  override readonly code = 'CONFLICT';
}

export class RateLimited extends HopakError {
  override readonly status = HttpStatus.TooManyRequests;
  override readonly code = 'RATE_LIMITED';
}

export class InternalError extends HopakError {
  override readonly status = HttpStatus.InternalServerError;
  override readonly code = 'INTERNAL_ERROR';
}

export class ConfigError extends HopakError {
  override readonly status = HttpStatus.InternalServerError;
  override readonly code = 'CONFIG_ERROR';
}
