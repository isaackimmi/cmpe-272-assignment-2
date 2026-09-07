import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected external network request in an offline test");
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});
