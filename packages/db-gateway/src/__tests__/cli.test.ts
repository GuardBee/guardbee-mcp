import { spawnSync } from "child_process";
import path from "path";
import { describe, expect, it } from "vitest";

// The built CLI: turbo builds before test. Without --help handling it would start the
// stdio server and wait on stdin, so a timeout here means the flag was ignored.
const cli = path.join(__dirname, "..", "..", "dist", "cli.js");
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 10_000, input: "" });

describe("guardbee-gateway CLI", () => {
  it("--help prints usage and exits 0", () => {
    const result = run("--help");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("DATABASE_URL");
  });

  it("an unknown argument is an error, not a server start", () => {
    const result = run("--bogus");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Unknown argument: --bogus");
  });
});
