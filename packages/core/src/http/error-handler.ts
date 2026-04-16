import { HopakError, HttpStatus, type Logger } from '@hopak/common';

export interface ErrorHandlerOptions {
  log: Logger;
  exposeStack?: boolean;
}

interface ErrorBody {
  error: string;
  message: string;
  detail?: string;
  stack?: string;
}

const SAFE_INTERNAL_MESSAGE = 'Something went wrong on our side.';

function buildSafeBody(
  message: string,
  stack: string | undefined,
  exposeStack: boolean,
): ErrorBody {
  const body: ErrorBody = { error: 'INTERNAL_ERROR', message: SAFE_INTERNAL_MESSAGE };
  if (exposeStack) {
    body.detail = message;
    if (stack) body.stack = stack;
  }
  return body;
}

export function handleError(error: unknown, options: ErrorHandlerOptions): Response {
  if (error instanceof HopakError) {
    return Response.json(error.toJSON(), { status: error.status });
  }

  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  options.log.error('Unhandled error', { message, stack });

  return Response.json(buildSafeBody(message, stack, options.exposeStack ?? false), {
    status: HttpStatus.InternalServerError,
  });
}
