import { execFileSync, spawnSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it } from "vitest";
import { applyIgnores, compareToBaseline, createBaseline, fingerprint, normalizeLocation } from "../baseline.js";
import { scanPath } from "../scanner.js";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "rs-baseline-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const minified = Array.from({ length: 300 }, (_, i) => `function a${i}(b){return b+${i}}`).join(";");
const mapJson = JSON.stringify({ version: 3, mappings: "AAAA", sources: ["src/App.tsx"], sourcesContent: ["x"] });

function build(root: string, files: Record<string, string>): void {
  for (const [p, data] of Object.entries(files)) {
    const full = join(root, ...p.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
  }
}

describe("normalizeLocation", () => {
  it("replaces bundler content hashes so the next build matches", () => {
    expect(normalizeLocation("/out/dist/assets/index-BvL4J5f8.js", "/out")).toBe("dist/assets/index-#.js");
    expect(normalizeLocation("/out/_next/static/chunks/7321-dd7cb90a7de65945.js", "/out")).toBe("_next/static/chunks/7321-#.js");
    expect(normalizeLocation("/out/chunk-HCOYIBKO.js", "/out/")).toBe("chunk-#.js");
    expect(normalizeLocation("/out/static/js/main.a1b2c3d4.chunk.js", "/out")).toBe("static/js/main.#.chunk.js");
  });

  it("keeps ordinary names and strips query strings", () => {
    expect(normalizeLocation("/out/src/LicenseValidator.js", "/out")).toBe("src/LicenseValidator.js");
    expect(normalizeLocation("https://site.test/js/app.js?ver=2.0.21", "https://site.test/")).toBe("js/app.js");
    expect(normalizeLocation("C:\\build\\out\\app.exe", "C:\\build")).toBe("out/app.exe");
  });
});

describe("compareToBaseline", () => {
  it("separates new, fixed and unchanged findings across two builds with different hashes", () => {
    const v1 = tmp();
    build(v1, {
      "assets/index-AAAA1111.js": `${minified}\n//# sourceMappingURL=index-AAAA1111.js.map`,
      "assets/index-AAAA1111.js.map": mapJson,
      "assets/vendor-BBBB2222.js": 'fetch("http://localhost:3000")',
    });
    const baseline = createBaseline(scanPath(v1));

    const v2 = tmp();
    build(v2, {
      "assets/index-CCCC3333.js": `${minified}\n//# sourceMappingURL=index-CCCC3333.js.map`,
      "assets/index-CCCC3333.js.map": mapJson,
      "assets/app-DDDD4444.js": 'const k="AKIAQ7XKZP3LMNB2RTUV";',
    });
    const diff = compareToBaseline(scanPath(v2), baseline);
    expect(diff.unchanged.map((f) => f.patternId)).toEqual(["sourcemap_embeds_source"]);
    expect(diff.added.map((f) => f.patternId)).toEqual(["bundle_secret"]);
    expect(diff.fixed).toEqual(["internal_endpoint|assets/vendor-#.js"]);
    expect(diff.previousGrade).toBe("F");
  });

  it("keeps two different keys in one file apart", () => {
    const root = tmp();
    // Assembled at runtime so the repository's secretlint hook does not read it as a leak.
    const githubToken = ["ghp", "R8kd2LmQ9xTz4VbN7wPa1sYc6HfJ3uEo5Gi0"].join("_");
    build(root, { "a.js": `const k="AKIAQ7XKZP3LMNB2RTUV";const g="${githubToken}";` });
    const r = scanPath(root);
    const fps = r.findings.map((f) => fingerprint(f, r.target));
    expect(new Set(fps).size).toBe(2);
  });
});

describe("applyIgnores", () => {
  it("drops ignored rules, by id or id:path, and re-grades", () => {
    const root = tmp();
    build(root, {
      "public/firebase-config.js": 'const k="AKIAQ7XKZP3LMNB2RTUV";',
      "public/app.js": 'fetch("http://localhost:1")',
    });
    const r = scanPath(root);
    expect(r.grade).toBe("F");
    expect(applyIgnores(r, ["bundle_secret:firebase-config.js"])).toBe(1);
    expect(r.findings.map((f) => f.patternId)).toEqual(["internal_endpoint"]);
    expect(r.grade).toBe("B");
    expect(r.notes).toContain("1 finding(s) suppressed by ignore rules");
    expect(applyIgnores(r, ["internal_endpoint"])).toBe(1);
    expect(r.grade).toBe("A");
  });

  it("does not drop a rule whose path does not match", () => {
    const root = tmp();
    build(root, { "app.js": 'const k="AKIAQ7XKZP3LMNB2RTUV";' });
    const r = scanPath(root);
    expect(applyIgnores(r, ["bundle_secret:other.js"])).toBe(0);
  });
});

describe("CLI baseline flow", () => {
  const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "cli.js");
  const run = (args: string[], cwd: string) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });

  it("fails only on findings the baseline does not already have", () => {
    const project = tmp();
    build(project, { "dist/app-AAAA1111.js": 'fetch("http://localhost:3000");const m=1;' + minified });
    const write = run(["scan", "dist", "--update-baseline"], project);
    expect(write.stderr).toContain("Baseline written: .reverse-shield-baseline.json (1 finding(s), grade B)");
    expect(JSON.parse(readFileSync(join(project, ".reverse-shield-baseline.json"), "utf8")).fingerprints).toEqual(["internal_endpoint|app-#.js"]);

    // Same exposure, new hash: nothing new, passes even with --fail-on=any.
    rmSync(join(project, "dist"), { recursive: true });
    build(project, { "dist/app-BBBB2222.js": 'fetch("http://localhost:3000");const m=2;' + minified });
    const same = run(["scan", "dist", "--baseline=.reverse-shield-baseline.json", "--fail-on=any"], project);
    expect(same.status).toBe(0);
    expect(same.stdout).toContain("0 new, 0 fixed, 1 unchanged");

    // A new key: fails, and SARIF marks it new while the old one stays unchanged.
    build(project, { "dist/keys-CCCC3333.js": 'const k="AKIAQ7XKZP3LMNB2RTUV";' });
    const worse = run(["scan", "dist", "--baseline=.reverse-shield-baseline.json", "--fail-on=high"], project);
    expect(worse.status).toBe(1);
    expect(worse.stdout).toContain("1 new, 0 fixed, 1 unchanged");
    const sarif = JSON.parse(execFileSync(process.execPath, [cli, "scan", "dist", "--baseline=.reverse-shield-baseline.json", "--format=sarif", "--fail-on=none"], { cwd: project, encoding: "utf8" }));
    const states = sarif.runs[0].results.map((r: { ruleId: string; baselineState: string }) => `${r.ruleId}:${r.baselineState}`).sort();
    expect(states).toEqual(["bundle_secret:new", "internal_endpoint:unchanged"]);
  });

  it("reads ignore and baseline from guardbee.yml", () => {
    const project = tmp();
    build(project, {
      "guardbee.yml": "reverse-shield:\n  fail-on: any\n  ignore:\n    - internal_endpoint\n",
      "dist/app.js": 'fetch("http://localhost:3000")',
    });
    const r = run(["scan", "dist"], project);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("1 finding(s) suppressed by ignore rules");
  });
});
