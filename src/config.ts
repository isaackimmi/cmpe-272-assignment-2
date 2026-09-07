export interface AppConfig {
  githubToken: string;
  githubOwner: string;
  githubRepo: string;
  webhookSecret: string;
  apiAuthToken: string;
  githubApiBaseUrl: string;
  eventsDatabasePath: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();

  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }

  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    githubToken: required(env, "GITHUB_TOKEN"),
    githubOwner: required(env, "GITHUB_OWNER"),
    githubRepo: required(env, "GITHUB_REPO"),
    webhookSecret: required(env, "WEBHOOK_SECRET"),
    apiAuthToken: required(env, "API_AUTH_TOKEN"),
    githubApiBaseUrl: env.GITHUB_API_BASE_URL?.trim() || "https://api.github.com",
    eventsDatabasePath: env.EVENTS_DATABASE_PATH?.trim() || "./data/events.sqlite",
  };
}
