import { EventEmitter } from "node:events";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { close, createApp, listen, logError, logInfo } = vi.hoisted(() => ({
  close: vi.fn().mockResolvedValue(undefined),
  createApp: vi.fn(),
  listen: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock("../../src/app", () => ({ createApp }));

import { main } from "../../src/index";

describe("server startup", () => {
  const originalExitCode = process.exitCode;
  let signals: EventEmitter;

  beforeEach(() => {
    signals = new EventEmitter();
    createApp.mockReturnValue({
      close,
      listen,
      log: { error: logError, info: logInfo },
    } as unknown as FastifyInstance);
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.exitCode = originalExitCode;
  });

  it("starts with the configured host and port", async () => {
    const removeShutdownHandlers = await main({ HOST: "127.0.0.1", PORT: "3000" }, signals);

    expect(listen).toHaveBeenCalledOnce();
    expect(listen).toHaveBeenCalledWith({ host: "127.0.0.1", port: 3000 });
    expect(logError).not.toHaveBeenCalled();
    removeShutdownHandlers?.();
  });

  it("closes Fastify and SQLite after a termination signal", async () => {
    const removeShutdownHandlers = await main({ HOST: "0.0.0.0", PORT: "3000" }, signals);

    signals.emit("SIGTERM");

    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(logInfo).toHaveBeenCalledWith({ signal: "SIGTERM" }, "graceful shutdown started");
    removeShutdownHandlers?.();
  });

  it("reports a missing host instead of starting", async () => {
    await main({ PORT: "3000" }, signals);

    expect(listen).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "HOST environment variable is required" }),
    );
    expect(process.exitCode).toBe(1);
  });

  it("reports an invalid port instead of starting", async () => {
    await main({ HOST: "127.0.0.1", PORT: "not-a-port" }, signals);

    expect(listen).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "PORT must be a valid port number" }),
    );
    expect(process.exitCode).toBe(1);
  });
});
