import { createVitestConfig } from "../../vitest.shared";

// The dataset and bypass tests run every detector over hundreds of documents: under a second
// locally, past the 5 s default on a cold CI runner
export default createVitestConfig({ test: { testTimeout: 30_000 } });
