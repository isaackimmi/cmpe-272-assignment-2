import { createApp } from "./app";

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  let app;

  try {
    app = createApp({ env });
    const host = env.HOST;
    const port = Number(env.PORT);

    if (!host) {
      throw new Error("HOST environment variable is required");
    }

    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error("PORT must be a valid port number");
    }

    await app.listen({ host, port });
  } catch (error) {
    if (app) {
      app.log.error(error);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}
