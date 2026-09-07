import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { EventStore } from "../../src/store/events";
import { authorizationHeaders, testConfig } from "../helpers";

function signature(body: string): string {
  return `sha256=${createHmac("sha256", testConfig.webhookSecret).update(body).digest("hex")}`;
}

async function deliver(
  app: FastifyInstance,
  event: string,
  deliveryId: string,
  payload: unknown,
  suppliedSignature?: string | null,
) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-github-event": event,
    "x-github-delivery": deliveryId,
  };

  if (suppliedSignature !== null) {
    headers["x-hub-signature-256"] = suppliedSignature ?? signature(body);
  }

  return app.inject({
    method: "POST",
    url: "/webhook",
    headers,
    payload: body,
  });
}

describe("webhook and event routes", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = createApp({ config: testConfig, logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it.each(["opened", "edited", "closed", "reopened"])(
    "stores an issues.%s delivery",
    async (action) => {
      const response = await deliver(app, "issues", `issue-${action}`, {
        action,
        repository: { full_name: "owner/repo" },
        issue: { number: 42 },
      });

      expect(response.statusCode).toBe(204);

      const events = await app.inject({
        method: "GET",
        url: "/events",
        headers: authorizationHeaders,
      });
      expect(events.json()).toEqual([
        expect.objectContaining({
          id: `issue-${action}`,
          event: "issues",
          action,
          issue_number: 42,
        }),
      ]);
    },
  );

  it.each(["created", "edited", "deleted"])(
    "stores an issue_comment.%s delivery",
    async (action) => {
      const response = await deliver(app, "issue_comment", `comment-${action}`, {
        action,
        repository: { full_name: "owner/repo" },
        issue: { number: 42 },
        comment: { id: 7 },
      });

      expect(response.statusCode).toBe(204);

      const events = await app.inject({
        method: "GET",
        url: "/events",
        headers: authorizationHeaders,
      });
      expect(events.json()).toEqual([
        expect.objectContaining({
          id: `comment-${action}`,
          event: "issue_comment",
          action,
          issue_number: 42,
          comment_id: 7,
        }),
      ]);
    },
  );

  it("stores a ping delivery without an issue number", async () => {
    const response = await deliver(app, "ping", "ping-1", {
      zen: "Keep it logically awesome.",
      hook_id: 9,
      repository: { full_name: "owner/repo" },
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");

    const events = await app.inject({
      method: "GET",
      url: "/events",
      headers: authorizationHeaders,
    });
    expect(events.json()).toEqual([
      expect.objectContaining({
        id: "ping-1",
        event: "ping",
        action: "ping",
        issue_number: null,
      }),
    ]);
  });

  it("acknowledges a duplicate without inserting another receipt", async () => {
    const payload = {
      action: "opened",
      repository: { full_name: "owner/repo" },
      issue: { number: 42 },
    };

    const [first, second] = await Promise.all([
      deliver(app, "issues", "duplicate-1", payload),
      deliver(app, "issues", "duplicate-1", payload),
    ]);

    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(204);

    const events = await app.inject({
      method: "GET",
      url: "/events",
      headers: authorizationHeaders,
    });
    expect(events.json()).toHaveLength(1);
  });

  it.each([
    ["missing", null],
    ["malformed", "sha256=not-a-valid-digest"],
  ])("rejects a %s signature without storing anything", async (_case, suppliedSignature) => {
    const response = await deliver(
      app,
      "issues",
      `signature-${_case}`,
      {
        action: "opened",
        repository: { full_name: "owner/repo" },
        issue: { number: 42 },
      },
      suppliedSignature,
    );

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "INVALID_WEBHOOK_SIGNATURE" });

    const events = await app.inject({
      method: "GET",
      url: "/events",
      headers: authorizationHeaders,
    });
    expect(events.json()).toEqual([]);
  });

  it("rejects a body changed after signing without storing anything", async () => {
    const signedBody = JSON.stringify({
      action: "opened",
      repository: { full_name: "owner/repo" },
      issue: { number: 42 },
    });
    const tamperedBody = signedBody.replace('"number":42', '"number":43');

    const response = await deliver(
      app,
      "issues",
      "tampered-body",
      tamperedBody,
      signature(signedBody),
    );

    expect(response.statusCode).toBe(401);

    const events = await app.inject({
      method: "GET",
      url: "/events",
      headers: authorizationHeaders,
    });
    expect(events.json()).toEqual([]);
  });

  it("rejects an invalid signature without storing anything", async () => {
    const response = await deliver(
      app,
      "issues",
      "invalid-signature",
      {
        action: "opened",
        repository: { full_name: "owner/repo" },
        issue: { number: 42 },
      },
      `sha256=${"0".repeat(64)}`,
    );

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "INVALID_WEBHOOK_SIGNATURE" });

    const events = await app.inject({
      method: "GET",
      url: "/events",
      headers: authorizationHeaders,
    });
    expect(events.json()).toEqual([]);
  });

  it("rejects malformed or wrong-repository payloads", async () => {
    const malformed = await deliver(app, "issues", "malformed", "{not-json");
    const wrongRepository = await deliver(app, "issues", "wrong-repository", {
      action: "opened",
      repository: { full_name: "someone/else" },
      issue: { number: 42 },
    });

    expect(malformed.statusCode).toBe(400);
    expect(wrongRepository.statusCode).toBe(400);
    expect(wrongRepository.json()).toMatchObject({ code: "INVALID_WEBHOOK" });
  });

  it.each([
    ["unknown event", "push", { repository: { full_name: "owner/repo" } }],
    [
      "unknown action",
      "issues",
      {
        action: "labeled",
        repository: { full_name: "owner/repo" },
        issue: { number: 42 },
      },
    ],
  ])("rejects an %s", async (_case, event, payload) => {
    const response = await deliver(app, event, `unsupported-${event}`, payload);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_WEBHOOK" });
  });

  it("returns 503 when a verified delivery cannot be stored", async () => {
    await app.close();
    const failingStore: EventStore = {
      insert: () => {
        throw new Error("database unavailable");
      },
      list: () => [],
      close: () => undefined,
    };
    app = createApp({ config: testConfig, eventStore: failingStore, logger: false });

    const response = await deliver(app, "issues", "storage-failure", {
      action: "opened",
      repository: { full_name: "owner/repo" },
      issue: { number: 42 },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: "STORAGE_UNAVAILABLE" });
  });

  it("returns 503 when stored events cannot be read", async () => {
    await app.close();
    const failingStore: EventStore = {
      insert: () => true,
      list: () => {
        throw new Error("database unavailable");
      },
      close: () => undefined,
    };
    app = createApp({ config: testConfig, eventStore: failingStore, logger: false });

    const response = await app.inject({
      method: "GET",
      url: "/events",
      headers: authorizationHeaders,
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: "STORAGE_UNAVAILABLE" });
  });
});
