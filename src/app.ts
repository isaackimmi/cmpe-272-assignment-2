import Fastify, { type FastifyInstance } from "fastify";
import { bearerAuthenticator } from "./auth";
import { GitHubClient } from "./clients/github";
import { loadConfig, type AppConfig } from "./config";
import { registerErrorHandler } from "./errors";
import { eventRoutes } from "./routes/events";
import { healthRoutes } from "./routes/health";
import { issueRoutes } from "./routes/issues";
import { webhookRoutes } from "./routes/webhook";
import { SqliteEventStore, type EventStore } from "./store/events";

export interface AppOptions {
  config?: AppConfig;
  env?: NodeJS.ProcessEnv;
  eventStore?: EventStore;
  fetchImpl?: typeof fetch;
  logger?: boolean;
  now?: () => number;
}

export function createApp(options: AppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig(options.env);
  const store = options.eventStore ?? new SqliteEventStore(config.eventsDatabasePath);
  const github = new GitHubClient(config, options.fetchImpl, options.now);
  const authenticate = bearerAuthenticator(config.apiAuthToken);
  const app = Fastify({
    logger: options.logger ?? true,
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  registerErrorHandler(app);
  app.register(healthRoutes);
  app.register(issueRoutes({ github, authenticate }));
  app.register(eventRoutes({ store, authenticate }));
  app.register(webhookRoutes({ config, store, now: options.now }));

  app.addHook("onClose", async () => {
    store.close();
  });

  return app;
}
