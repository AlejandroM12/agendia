import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";
import path from "node:path";

// Pruebas de carga LOCALES (npm run loadtest:local). Usan una base descartable propia (test/global-setup.ts),
// nunca la de desarrollo ni, por supuesto, la de producción.
loadEnv({ path: ".env.local", quiet: true });

export default defineConfig({
  test: {
    environment: "node",
    include: ["loadtest/**/*.loadtest.ts"],
    globalSetup: ["test/global-setup.ts"],
    fileParallelism: false,
    hookTimeout: 600_000,
    testTimeout: 600_000,
  },
  resolve: {
    alias: {
      "@": import.meta.dirname,
      "server-only": path.resolve(import.meta.dirname, "test/server-only-stub.ts"),
    },
  },
});
