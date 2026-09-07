import type { AppConfig } from "../src/config";

export const testConfig: AppConfig = {
  githubToken: "github-test-token",
  githubOwner: "owner",
  githubRepo: "repo",
  webhookSecret: "webhook-test-secret",
  apiAuthToken: "gateway-test-token",
  githubApiBaseUrl: "https://api.github.test",
  eventsDatabasePath: ":memory:",
};

export const authorizationHeaders = {
  authorization: `Bearer ${testConfig.apiAuthToken}`,
};

export const githubIssue = {
  number: 42,
  html_url: "https://github.com/owner/repo/issues/42",
  state: "open" as const,
  title: "Test issue",
  body: "Issue body",
  labels: [{ name: "bug" }],
  created_at: "2026-09-07T00:00:00Z",
  updated_at: "2026-09-07T00:00:00Z",
};

export const githubComment = {
  id: 7,
  body: "Test comment",
  user: { login: "octocat" },
  created_at: "2026-09-07T00:20:00Z",
  updated_at: "2026-09-07T00:20:00Z",
  html_url: "https://github.com/owner/repo/issues/42#issuecomment-7",
  url: "https://api.github.com/repos/owner/repo/issues/comments/7",
};
