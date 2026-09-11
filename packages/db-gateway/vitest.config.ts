import { createVitestConfig } from "../../vitest.shared";

export default createVitestConfig({
  test: {
    globals: false,
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
});
