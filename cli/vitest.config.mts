import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The integration test reuses the app's own lib/auth-config.ts (see its
// comment), which internally imports "@/lib/schema" — the same alias
// vitest.config.mts at the repo root resolves, needed here too since this is
// the vitest instance that ends up loading that file.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig({
  resolve: {
    alias: { "@": repoRoot },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Spawns a real `next dev` and polls a real device-code flow over HTTP.
    testTimeout: 60_000,
    hookTimeout: 90_000,
  },
});
