import { describe, expect, it, vi } from "vitest";
import { GitHubClient } from "../../src/clients/github";
import { AppError } from "../../src/errors";
import { githubIssue, testConfig } from "../helpers";

describe("GitHubClient reliability", () => {
  it("honors Retry-After and blocks requests during the cooldown", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: "rate limit exceeded" }), {
        status: 429,
        headers: { "retry-after": "30" },
      }),
    );
    const client = new GitHubClient(testConfig, fetchImpl, () => 1_000);

    await expect(client.getIssue(42)).rejects.toMatchObject({
      statusCode: 429,
      code: "GITHUB_RATE_LIMITED",
      retryAfter: 30,
    } satisfies Partial<AppError>);
    await expect(client.getIssue(42)).rejects.toMatchObject({
      statusCode: 429,
      retryAfter: 30,
    } satisfies Partial<AppError>);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("returns a successful response that exhausts the quota, then cools down", async () => {
    let now = 1_000;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(githubIssue), {
        status: 200,
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "2",
        },
      }),
    );
    const client = new GitHubClient(testConfig, fetchImpl, () => now);

    await expect(client.getIssue(42)).resolves.toMatchObject({ number: 42 });
    now = 1_500;
    await expect(client.getIssue(42)).rejects.toMatchObject({
      statusCode: 429,
      retryAfter: 1,
    } satisfies Partial<AppError>);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("maps a network failure to service unavailable", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    const client = new GitHubClient(testConfig, fetchImpl);

    await expect(client.getIssue(42)).rejects.toMatchObject({
      statusCode: 503,
      code: "GITHUB_UNAVAILABLE",
    } satisfies Partial<AppError>);
  });
});
