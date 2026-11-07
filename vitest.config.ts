import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    globalSetup: ["tests/setup/globalSetup.ts"],
    setupFiles: ["tests/setup/env.ts"],
    // The suite shares one test database.
    fileParallelism: false,
  },
});
