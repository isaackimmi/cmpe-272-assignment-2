import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createApp, listen, logError } = vi.hoisted(() => ({
  createApp: vi.fn(),
  listen: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("../../src/app", () => ({ createApp }));

import { main } from "../../src/index";

describe("server startup", () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    createApp.mockReturnValue({
      listen,
      log: { error: logError },
    } as unknown as FastifyInstance);
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.exitCode = originalExitCode;
  });

  it("starts with the configured host and port", async () => {
    await main({ HOST: "127.0.0.1", PORT: "3000" });

    expect(listen).toHaveBeenCalledOnce();
    expect(listen).toHaveBeenCalledWith({ host: "127.0.0.1", port: 3000 });
    expect(logError).not.toHaveBeenCalled();
  });

  it("reports a missing host instead of starting", async () => {
    await main({ PORT: "3000" });

    expect(listen).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "HOST environment variable is required" }),
    );
    expect(process.exitCode).toBe(1);
  });

  it("reports an invalid port instead of starting", async () => {
    await main({ HOST: "127.0.0.1", PORT: "not-a-port" });

    expect(listen).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "PORT must be a valid port number" }),
    );
    expect(process.exitCode).toBe(1);
  });
});
