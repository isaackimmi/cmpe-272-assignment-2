import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { loadConfig } from "../../../src/config";

interface IssueResponse {
  number: number;
  title: string;
  state: "open" | "closed";
}

interface CommentResponse {
  id: number;
  body: string;
}

async function waitForIssueInList(
  app: FastifyInstance,
  authorization: string,
  issueNumber: number,
): Promise<IssueResponse> {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const response = await app.inject({
      method: "GET",
      url: "/issues?state=all&per_page=100&page=1",
      headers: { authorization },
    });

    if (response.statusCode !== 200) {
      throw new Error(`GET /issues returned ${response.statusCode}`);
    }

    const issue = response
      .json<IssueResponse[]>()
      .find((candidate) => candidate.number === issueNumber);

    if (issue) {
      return issue;
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`Issue ${issueNumber} did not appear in GET /issues within 30 seconds`);
}

describe("live GitHub issue lifecycle", () => {
  let app: FastifyInstance;
  let authorization: string;
  let createdIssueNumber: number | undefined;

  beforeAll(() => {
    const config = {
      ...loadConfig(process.env),
      eventsDatabasePath: ":memory:",
    };
    authorization = `Bearer ${config.apiAuthToken}`;
    app = createApp({ config, logger: false });
  });

  afterAll(async () => {
    if (createdIssueNumber !== undefined) {
      await app.inject({
        method: "PATCH",
        url: `/issues/${createdIssueNumber}`,
        headers: { authorization },
        payload: { state: "closed" },
      });
    }

    await app.close();
  });

  it("creates, reads, edits, closes, reopens, comments on, and lists its own issue", async () => {
    const uniqueTitle = `CMPE 272 live integration ${new Date().toISOString()}`;
    const created = await app.inject({
      method: "POST",
      url: "/issues",
      headers: { authorization },
      payload: { title: uniqueTitle, body: "Created by the opt-in integration test." },
    });

    expect(created.statusCode).toBe(201);
    const createdIssue = created.json<IssueResponse>();
    createdIssueNumber = createdIssue.number;
    expect(created.headers.location).toBe(`/issues/${createdIssueNumber}`);

    const read = await app.inject({
      method: "GET",
      url: `/issues/${createdIssueNumber}`,
      headers: { authorization },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json<IssueResponse>().title).toBe(uniqueTitle);

    const editedTitle = `${uniqueTitle} edited`;
    const edited = await app.inject({
      method: "PATCH",
      url: `/issues/${createdIssueNumber}`,
      headers: { authorization },
      payload: { title: editedTitle },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json<IssueResponse>().title).toBe(editedTitle);

    for (const state of ["closed", "open"] as const) {
      const changed = await app.inject({
        method: "PATCH",
        url: `/issues/${createdIssueNumber}`,
        headers: { authorization },
        payload: { state },
      });
      expect(changed.statusCode).toBe(200);
      expect(changed.json<IssueResponse>().state).toBe(state);
    }

    const commentBody = `Live integration comment ${new Date().toISOString()}`;
    const commented = await app.inject({
      method: "POST",
      url: `/issues/${createdIssueNumber}/comments`,
      headers: { authorization },
      payload: { body: commentBody },
    });
    expect(commented.statusCode).toBe(201);
    const createdComment = commented.json<CommentResponse>();

    const comments = await app.inject({
      method: "GET",
      url: `/issues/${createdIssueNumber}/comments?per_page=10&page=1`,
      headers: { authorization },
    });
    expect(comments.statusCode).toBe(200);
    expect(comments.json<CommentResponse[]>()).toContainEqual(
      expect.objectContaining({ id: createdComment.id, body: commentBody }),
    );

    const listedIssue = await waitForIssueInList(
      app,
      authorization,
      createdIssueNumber,
    );
    expect(listedIssue).toMatchObject({
      number: createdIssueNumber,
      title: editedTitle,
    });
  }, 60_000);
});
