import { createVitestConfig } from "../../vitest.shared";

export default createVitestConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
});
