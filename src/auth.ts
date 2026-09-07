import { timingSafeEqual } from "node:crypto";
import type { onRequestHookHandler } from "fastify";
import { AppError } from "./errors";

function equalSecret(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function bearerAuthenticator(expectedToken: string): onRequestHookHandler {
  return async (request) => {
    const authorization = request.headers.authorization;
    const prefix = "Bearer ";
    const suppliedToken = authorization?.startsWith(prefix)
      ? authorization.slice(prefix.length)
      : "";

    if (!suppliedToken || !equalSecret(suppliedToken, expectedToken)) {
      throw new AppError(
        401,
        "UNAUTHORIZED",
        "A valid bearer token is required",
      );
    }
  };
}
