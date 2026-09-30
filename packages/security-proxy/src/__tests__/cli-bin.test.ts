import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("guardbee-proxy bin", () => {
  it("starts with a node shebang, or npx runs it as a shell script", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "cli.ts"), "utf8");
    expect(source.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });
});
