import { createVitestConfig } from "../../vitest.shared";

// Several tests run the CLI or git as child processes, which takes seconds on a cold CI runner.
export default createVitestConfig({ test: { testTimeout: 20_000 } });
