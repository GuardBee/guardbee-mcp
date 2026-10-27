import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("guardbee-proxy bin", () => {
  it("starts with a node shebang, or npx runs it as a shell script", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "cli.ts"), "utf8");
    expect(source.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });
});

describe("guardbee-proxy --help / --version", () => {
  // Runs the built CLI: turbo builds before test
  const cli = path.join(__dirname, "..", "..", "dist", "cli.js");
  const run = (arg: string) => require("child_process").spawnSync(process.execPath, [cli, arg], { encoding: "utf8", timeout: 10_000 });

  it("prints usage and exits 0 instead of trying to start a server", () => {
    const result = run("--help");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("guardbee-proxy init");
  });

  it("prints the package version", () => {
    const { version } = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"));
    expect(run("--version").stdout.trim()).toBe(version);
  });
});
