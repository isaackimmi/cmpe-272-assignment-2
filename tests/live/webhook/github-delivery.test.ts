import { describe, expect, it } from "vitest";

interface IssueResponse {
  number: number;
}

interface CommentResponse {
  id: number;
}

interface StoredEvent {
  event: "issues" | "issue_comment" | "ping";
  action: string;
  issue_number: number | null;
  comment_id?: number;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required for the live webhook test`);
  }

  return value;
}

const baseUrl = process.env.LIVE_BASE_URL?.trim() ||
  `http://127.0.0.1:${process.env.PORT?.trim() || "3000"}`;

async function gatewayRequest(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${requiredEnv("API_AUTH_TOKEN")}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

async function waitForEvent(
  matches: (event: StoredEvent) => boolean,
): Promise<StoredEvent> {
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    const response = await gatewayRequest("/events?limit=100");

    if (!response.ok) {
      throw new Error(`GET /events returned ${response.status}`);
    }

    const event = (await response.json() as StoredEvent[]).find(matches);

    if (event) {
      return event;
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error("The expected GitHub webhook was not received within 60 seconds");
}

describe("live GitHub webhook delivery", () => {
  it("receives issue and comment events through the configured tunnel", async () => {
    let issueNumber: number | undefined;

    try {
      const created = await gatewayRequest("/issues", {
        method: "POST",
        body: JSON.stringify({
          title: `CMPE 272 webhook integration ${new Date().toISOString()}`,
          body: "Created to verify real GitHub webhook delivery.",
        }),
      });
      expect(created.status).toBe(201);
      issueNumber = (await created.json() as IssueResponse).number;

      await expect(
        waitForEvent(
          (event) =>
            event.event === "issues" &&
            event.action === "opened" &&
            event.issue_number === issueNumber,
        ),
      ).resolves.toBeDefined();

      const commented = await gatewayRequest(`/issues/${issueNumber}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: "Webhook integration test comment." }),
      });
      expect(commented.status).toBe(201);
      const commentId = (await commented.json() as CommentResponse).id;

      await expect(
        waitForEvent(
          (event) =>
            event.event === "issue_comment" &&
            event.action === "created" &&
            event.issue_number === issueNumber &&
            event.comment_id === commentId,
        ),
      ).resolves.toBeDefined();
    } finally {
      if (issueNumber !== undefined) {
        await gatewayRequest(`/issues/${issueNumber}`, {
          method: "PATCH",
          body: JSON.stringify({ state: "closed" }),
        });
      }
    }
  }, 150_000);
});
