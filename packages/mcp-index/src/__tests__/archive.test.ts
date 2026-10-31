import { describe, expect, it } from "vitest";
import { readTarGz, readZip } from "../archive.js";
import { keepSource } from "../sources.js";
import { tarGz, zip } from "./helpers.js";

describe("readTarGz", () => {
  it("returns regular files and skips links, traversal and oversized files", () => {
    const archive = tarGz({ "package/index.js": "console.log(1)", "package/big.js": "x".repeat(2048), "../evil.js": "boom", "/abs.js": "boom" }, [{ name: "package/link.js", type: "2" }]);
    const files = readTarGz(archive, { maxFile: 1024 });
    expect(files.map((f) => f.path)).toEqual(["package/index.js"]);
    expect(files[0]!.data.toString()).toBe("console.log(1)");
  });

  it("refuses an archive that expands past the total limit", () => {
    expect(() => readTarGz(tarGz({ "a.js": "a".repeat(100_000) }), { maxTotal: 10_000 })).toThrow();
  });
});

describe("readZip", () => {
  it("inflates entries and applies the keep filter", () => {
    const files = readZip(zip({ "pkg/server.py": "print(1)", "pkg/tests/test_x.py": "assert 1", "pkg-1.0.dist-info/METADATA": "Name: pkg" }), { keep: keepSource });
    expect(files.map((f) => [f.path, f.data.toString()])).toEqual([["pkg/server.py", "print(1)"]]);
  });
});

describe("keepSource", () => {
  it("keeps runtime source and drops tests, examples, type declarations", () => {
    expect(["dist/index.js", "src/server.py", "cmd/main.go", "lib/a.mjs"].every(keepSource)).toBe(true);
    expect(["test/a.js", "src/a.test.ts", "examples/demo.js", "dist/index.d.ts", "README.md", "pkg/test_server.py"].some(keepSource)).toBe(false);
  });
});
