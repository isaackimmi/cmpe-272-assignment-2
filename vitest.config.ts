import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
          setupFiles: ["tests/setup/block-network.ts"],
        },
      },
      {
        test: {
          name: "routes",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "contract",
          environment: "node",
          include: ["tests/contract/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "live-integration",
          environment: "node",
          include: ["tests/live/integration/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "live-webhook",
          environment: "node",
          include: ["tests/live/webhook/**/*.test.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html"],
      thresholds: {
        lines: 80,
      },
    },
  },
});
