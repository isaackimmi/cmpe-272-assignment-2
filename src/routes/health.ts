import type { FastifyPluginAsync } from "fastify";
import { healthResponseSchema } from "../schemas/health";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/healthz",
    {
      schema: {
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async () => {
      return { status: "ok" };
    },
  );
};
