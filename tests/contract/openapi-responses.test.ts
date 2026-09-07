import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020, { type AnySchema } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { FastifyInstance } from "fastify";
import { parse } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { authorizationHeaders, githubComment, githubIssue, testConfig } from "../helpers";

interface OpenApiDocument {
  components: {
    schemas: Record<string, AnySchema>;
  };
}

const openApi = parse(readFileSync(join(process.cwd(), "openapi.yaml"), "utf8")) as OpenApiDocument;
const documentId = "https://assignment.test/openapi.yaml";
const ajv = new Ajv2020({ allErrors: true, strict: false });

addFormats(ajv);
ajv.addSchema({
  $id: documentId,
  $schema: "https://json-schema.org/draft/2020-12/schema",
  components: openApi.components,
});

function expectComponent(component: string, value: unknown): void {
  const validate = ajv.compile({
    $ref: `${documentId}#/components/schemas/${component}`,
  });

  expect(validate(value), JSON.stringify(validate.errors, null, 2)).toBe(true);
}

const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? "GET";

  if (method === "GET" && url.endsWith("/issues/42")) {
    return new Response(JSON.stringify(githubIssue), { status: 200 });
  }

  if (method === "POST" && url.endsWith("/issues/42/comments")) {
    return new Response(JSON.stringify(githubComment), { status: 201 });
  }

  throw new Error(`Unexpected GitHub request: ${method} ${url}`);
}) as typeof fetch;

describe("OpenAPI response components", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("accepts representative responses produced by the Fastify application", async () => {
    app = createApp({ config: testConfig, fetchImpl, logger: false });

    const health = await app.inject({ method: "GET", url: "/healthz" });
    expect(health.statusCode).toBe(200);
    expectComponent("Health", health.json());

    const issue = await app.inject({
      method: "GET",
      url: "/issues/42",
      headers: authorizationHeaders,
    });
    expect(issue.statusCode).toBe(200);
    expectComponent("Issue", issue.json());

    const comment = await app.inject({
      method: "POST",
      url: "/issues/42/comments",
      headers: authorizationHeaders,
      payload: { body: "Test comment" },
    });
    expect(comment.statusCode).toBe(201);
    expectComponent("Comment", comment.json());

    const unauthorized = await app.inject({ method: "GET", url: "/issues/42" });
    expect(unauthorized.statusCode).toBe(401);
    expectComponent("Error", unauthorized.json());

    const webhookBody = JSON.stringify({
      action: "opened",
      repository: { full_name: "owner/repo" },
      issue: { number: 42 },
    });
    const webhook = await app.inject({
      method: "POST",
      url: "/webhook",
      headers: {
        "content-type": "application/json",
        "x-github-event": "issues",
        "x-github-delivery": "contract-delivery",
        "x-hub-signature-256": `sha256=${createHmac("sha256", testConfig.webhookSecret)
          .update(webhookBody)
          .digest("hex")}`,
      },
      payload: webhookBody,
    });
    expect(webhook.statusCode).toBe(204);

    const events = await app.inject({
      method: "GET",
      url: "/events",
      headers: authorizationHeaders,
    });
    expect(events.statusCode).toBe(200);
    expect(events.json()).toHaveLength(1);
    expectComponent("WebhookEvent", events.json()[0]);
  });
});
