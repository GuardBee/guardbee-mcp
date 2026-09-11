import { defineConfig, mergeConfig, type UserConfig } from "vitest/config";

const base = defineConfig({
  test: {
    environment: "node",
  },
});

export function createVitestConfig(overrides: UserConfig = {}) {
  return mergeConfig(base, defineConfig(overrides));
}
