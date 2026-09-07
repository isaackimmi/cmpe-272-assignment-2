import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config";

const requiredEnvironment = {
  GITHUB_TOKEN: "github-token",
  GITHUB_OWNER: "owner",
  GITHUB_REPO: "repo",
  WEBHOOK_SECRET: "webhook-secret",
  API_AUTH_TOKEN: "gateway-token",
};

describe("loadConfig", () => {
  it("loads required values and applies local defaults", () => {
    expect(loadConfig(requiredEnvironment)).toEqual({
      githubToken: "github-token",
      githubOwner: "owner",
      githubRepo: "repo",
      webhookSecret: "webhook-secret",
      apiAuthToken: "gateway-token",
      githubApiBaseUrl: "https://api.github.com",
      eventsDatabasePath: "./data/events.sqlite",
    });
  });

  it("rejects a missing required value", () => {
    expect(() => loadConfig({ ...requiredEnvironment, GITHUB_TOKEN: "" })).toThrow(
      "GITHUB_TOKEN environment variable is required",
    );
  });
});
