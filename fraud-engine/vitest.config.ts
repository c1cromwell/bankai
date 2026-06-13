import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Quiet the structured logger during tests.
    env: { LOG_LEVEL: "silent" },
  },
});
