import { createRequire } from "module";
import path from "path";
import { describe, expect, it } from "vitest";

// The build is CommonJS: tsc turns `await import("pkg")` into require("pkg"). An
// ESM-only package must then export a condition require can resolve, or the
// feature fails only in the published proxy (vitest runs the sources as ESM).
describe("optional packages load from the CommonJS build", () => {
  const require = createRequire(path.join(process.cwd(), "package.json"));

  it("@guardbee/mcp-document-scanner (interceptors.documents)", () => {
    expect(typeof require("@guardbee/mcp-document-scanner").scanBytes).toBe("function");
  });

  it("@guardbee/ner resolves through a default export condition (ner.modelDir)", () => {
    const manifest = require("../ner/package.json") as { exports: Record<string, Record<string, string>> };
    expect(manifest.exports["."]!["default"]).toBe("./dist/index.js");
  });
});
