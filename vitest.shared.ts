import { defineConfig, mergeConfig, type UserConfig } from "vitest/config";

const base = defineConfig({
  test: {
    environment: "node",
    // Vitest 5 no longer leaves out dist/ by default; the compiled tests there are not the source of truth
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});

export function createVitestConfig(overrides: UserConfig = {}) {
  return mergeConfig(base, defineConfig(overrides));
}
