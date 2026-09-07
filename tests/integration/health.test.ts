import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { testConfig } from "../helpers";

describe("GET /healthz", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = createApp({ config: testConfig, logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns the service status and a request ID", async () => {
    const response = await app.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
  });
});
