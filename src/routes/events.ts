import type { FastifyPluginAsync, onRequestHookHandler } from "fastify";
import { AppError } from "../errors";
import { eventListQuerySchema, storedEventSchema } from "../schemas/events";
import { standardErrorResponses } from "../schemas/errors";
import type { EventStore } from "../store/events";

interface EventQuery {
  limit: number;
}

interface EventRouteDependencies {
  store: EventStore;
  authenticate: onRequestHookHandler;
}

export function eventRoutes({
  store,
  authenticate,
}: EventRouteDependencies): FastifyPluginAsync {
  return async (app) => {
    app.get<{ Querystring: EventQuery }>(
      "/events",
      {
        onRequest: authenticate,
        schema: {
          querystring: eventListQuerySchema,
          response: {
            200: { type: "array", items: storedEventSchema },
            ...standardErrorResponses,
          },
        },
      },
      async (request) => {
        try {
          return store.list(request.query.limit).map((event) => {
            const common = {
              id: event.id,
              event: event.event,
              action: event.action,
              issue_number: event.issue_number,
              timestamp: event.timestamp,
            };

            return "comment_id" in event
              ? { ...common, comment_id: event.comment_id }
              : common;
          });
        } catch {
          throw new AppError(
            503,
            "STORAGE_UNAVAILABLE",
            "The webhook receipt store is temporarily unavailable",
          );
        }
      },
    );
  };
}
