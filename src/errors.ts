import type { FastifyError, FastifyInstance } from "fastify";

export interface ErrorResponse {
  code: string;
  message: string;
  requestId: string;
  upstreamStatus?: number;
}

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly upstreamStatus?: number,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}

function responseFor(error: AppError, requestId: string): ErrorResponse {
  return {
    code: error.code,
    message: error.message,
    requestId,
    ...(error.upstreamStatus === undefined
      ? {}
      : { upstreamStatus: error.upstreamStatus }),
  };
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      if (error.retryAfter !== undefined) {
        reply.header("retry-after", error.retryAfter);
      }

      return reply.code(error.statusCode).send(responseFor(error, request.id));
    }

    if (error.validation || error.statusCode === 400 || error.statusCode === 415) {
      return reply.code(400).send({
        code: "INVALID_REQUEST",
        message: "Request validation failed",
        requestId: request.id,
      } satisfies ErrorResponse);
    }

    request.log.error({ err: error }, "unexpected application error");
    return reply.code(500).send({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      requestId: request.id,
    } satisfies ErrorResponse);
  });
}
