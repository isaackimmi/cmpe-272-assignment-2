import type { FastifyInstance } from "fastify";
import { createApp } from "./app";

interface SignalSource {
  once(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

export function registerGracefulShutdown(
  app: FastifyInstance,
  signalSource: SignalSource = process,
): () => void {
  let shuttingDown = false;

  const shutdown = async (signal: "SIGINT" | "SIGTERM") => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    app.log.info({ signal }, "graceful shutdown started");

    try {
      await app.close();
    } catch (error) {
      app.log.error(error, "graceful shutdown failed");
      process.exitCode = 1;
    }
  };

  const onSigint = () => void shutdown("SIGINT");
  const onSigterm = () => void shutdown("SIGTERM");

  signalSource.once("SIGINT", onSigint);
  signalSource.once("SIGTERM", onSigterm);

  return () => {
    signalSource.off("SIGINT", onSigint);
    signalSource.off("SIGTERM", onSigterm);
  };
}

export async function main(
  env: NodeJS.ProcessEnv = process.env,
  signalSource: SignalSource = process,
): Promise<(() => void) | undefined> {
  let app: FastifyInstance | undefined;

  try {
    app = createApp({ env });
    const host = env.HOST;
    const port = Number(env.PORT);

    if (!host) {
      throw new Error("HOST environment variable is required");
    }

    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error("PORT must be a valid port number");
    }

    await app.listen({ host, port });
    return registerGracefulShutdown(app, signalSource);
  } catch (error) {
    if (app) {
      app.log.error(error);
      const createdApp = app;
      await createdApp.close().catch((closeError) => createdApp.log.error(closeError));
    } else {
      console.error(error);
    }
    process.exitCode = 1;
    return undefined;
  }
}

if (require.main === module) {
  void main();
}
