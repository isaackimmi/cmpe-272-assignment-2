import type { FastifyInstance } from "fastify";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { authorizationHeaders, githubComment, githubIssue, testConfig } from "../helpers";

const repositoryUrl = "https://api.github.test/repos/owner/repo";
const server = setupServer();

describe("issue and comment routes", () => {
  let app: FastifyInstance;

  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

  beforeEach(() => {
    app = createApp({ config: testConfig, logger: false });
  });

  afterEach(async () => {
    server.resetHandlers();
    await app.close();
  });

  afterAll(() => server.close());

  it("requires the gateway bearer token", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/issues",
      payload: { body: "Invalid body that should not be inspected first" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: "UNAUTHORIZED",
      message: "A valid bearer token is required",
      requestId: expect.any(String),
    });
  });

  it("creates an issue and returns its gateway location", async () => {
    server.use(
      http.post(`${repositoryUrl}/issues`, async ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer github-test-token");
        expect(request.headers.get("x-github-api-version")).toBe("2026-03-10");
        expect(await request.json()).toEqual({
          title: "Test issue",
          body: "Issue body",
          labels: ["bug"],
        });
        return HttpResponse.json(githubIssue, { status: 201 });
      }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/issues",
      headers: authorizationHeaders,
      payload: { title: "Test issue", body: "Issue body", labels: ["bug"] },
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers.location).toBe("/issues/42");
    expect(response.json()).toMatchObject({ number: 42, labels: ["bug"] });
  });

  it("rejects an invalid issue before calling GitHub", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/issues",
      headers: authorizationHeaders,
      payload: { body: "Missing title" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "INVALID_REQUEST",
      requestId: expect.any(String),
    });
  });

  it.each([
    ["unsupported state", "/issues?state=archived"],
    ["page below one", "/issues?page=0"],
    ["page size above 100", "/issues?per_page=101"],
  ])("rejects %s query input before calling GitHub", async (_case, url) => {
    const response = await app.inject({
      method: "GET",
      url,
      headers: authorizationHeaders,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "INVALID_REQUEST",
      requestId: expect.any(String),
    });
  });

  it("lists issues with filters and forwards GitHub's Link header", async () => {
    const link = '<https://api.github.test/issues?page=2>; rel="next"';
    server.use(
      http.get(`${repositoryUrl}/issues`, ({ request }) => {
        const url = new URL(request.url);
        expect(Object.fromEntries(url.searchParams)).toEqual({
          state: "closed",
          page: "2",
          per_page: "10",
          labels: "bug,help wanted",
        });
        return HttpResponse.json([githubIssue], { headers: { link } });
      }),
    );

    const response = await app.inject({
      method: "GET",
      url: "/issues?state=closed&labels=bug%2Chelp%20wanted&page=2&per_page=10",
      headers: authorizationHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.link).toBe(link);
    expect(response.json()).toHaveLength(1);
  });

  it("reads one issue", async () => {
    server.use(http.get(`${repositoryUrl}/issues/42`, () => HttpResponse.json(githubIssue)));

    const response = await app.inject({
      method: "GET",
      url: "/issues/42",
      headers: authorizationHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ number: 42, title: "Test issue" });
  });

  it("updates an issue", async () => {
    server.use(
      http.patch(`${repositoryUrl}/issues/42`, async ({ request }) => {
        expect(await request.json()).toEqual({ state: "closed" });
        return HttpResponse.json({ ...githubIssue, state: "closed" });
      }),
    );

    const response = await app.inject({
      method: "PATCH",
      url: "/issues/42",
      headers: authorizationHeaders,
      payload: { state: "closed" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().state).toBe("closed");
  });

  it("creates a comment", async () => {
    server.use(
      http.post(`${repositoryUrl}/issues/42/comments`, async ({ request }) => {
        expect(await request.json()).toEqual({ body: "Test comment" });
        return HttpResponse.json(githubComment, { status: 201 });
      }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/issues/42/comments",
      headers: authorizationHeaders,
      payload: { body: "Test comment" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers.location).toBe(githubComment.url);
    expect(response.json()).toMatchObject({ id: 7, body: "Test comment" });
  });

  it("lists comments with pagination", async () => {
    const link = '<https://api.github.test/comments?page=2>; rel="next"';
    server.use(
      http.get(`${repositoryUrl}/issues/42/comments`, ({ request }) => {
        const url = new URL(request.url);
        expect(Object.fromEntries(url.searchParams)).toEqual({
          page: "2",
          per_page: "5",
        });
        return HttpResponse.json([githubComment], { headers: { link } });
      }),
    );

    const response = await app.inject({
      method: "GET",
      url: "/issues/42/comments?page=2&per_page=5",
      headers: authorizationHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.link).toBe(link);
    expect(response.json()).toEqual([githubComment]);
  });

  it("maps GitHub not-found responses without exposing the upstream body", async () => {
    server.use(
      http.get(`${repositoryUrl}/issues/42`, () =>
        HttpResponse.json({ message: "sensitive upstream detail" }, { status: 404 }),
      ),
    );

    const response = await app.inject({
      method: "GET",
      url: "/issues/42",
      headers: authorizationHeaders,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      code: "GITHUB_NOT_FOUND",
      message: "The requested GitHub resource was not found",
      upstreamStatus: 404,
    });
    expect(response.body).not.toContain("sensitive upstream detail");
  });

  it("maps GitHub validation failures to 400", async () => {
    server.use(
      http.post(`${repositoryUrl}/issues`, () =>
        HttpResponse.json({ message: "Validation Failed" }, { status: 422 }),
      ),
    );

    const response = await app.inject({
      method: "POST",
      url: "/issues",
      headers: authorizationHeaders,
      payload: { title: "Test issue" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "GITHUB_VALIDATION_FAILED",
      upstreamStatus: 422,
    });
  });

  it("maps GitHub server failures to 503", async () => {
    server.use(
      http.get(`${repositoryUrl}/issues/42`, () =>
        HttpResponse.json({ message: "failure" }, { status: 500 }),
      ),
    );

    const response = await app.inject({
      method: "GET",
      url: "/issues/42",
      headers: authorizationHeaders,
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: "GITHUB_UNAVAILABLE",
      upstreamStatus: 500,
    });
  });

  it("returns GitHub's rate-limit delay to the caller", async () => {
    server.use(
      http.get(`${repositoryUrl}/issues/42`, () =>
        HttpResponse.json(
          { message: "API rate limit exceeded" },
          { status: 429, headers: { "retry-after": "15" } },
        ),
      ),
    );

    const response = await app.inject({
      method: "GET",
      url: "/issues/42",
      headers: authorizationHeaders,
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("15");
    expect(response.json()).toMatchObject({
      code: "GITHUB_RATE_LIMITED",
      upstreamStatus: 429,
    });
  });
});
