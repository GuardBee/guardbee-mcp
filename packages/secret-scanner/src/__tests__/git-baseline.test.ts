import { execFileSync, spawnSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { applyBaseline, readBaseline, toBaseline, writeBaseline } from "../baseline.js";
import { scanGit } from "../git.js";
import { buildSarif } from "../sarif.js";
import { fingerprintOf, scanDirectory, scanText } from "../scanner.js";

// Random values assembled at runtime so the repo's own secret scan does not flag this file
const GH = ["ghp", "u8jzPde0IgxLd6GncfBAepfJBd0Kh8oOOL8d"].join("_");
const GH2 = ["ghp", "Q7tLm2vXc9RkB4nW1yZp6sDf3hJ8gKa5eUoT"].join("_");

const repos: string[] = [];
afterEach(() => {
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ENV = { ...process.env, GIT_AUTHOR_NAME: "Ayşe", GIT_AUTHOR_EMAIL: "a@acme.test", GIT_COMMITTER_NAME: "Ayşe", GIT_COMMITTER_EMAIL: "a@acme.test" };

function repo(): { dir: string; git: (...args: string[]) => string; write: (file: string, text: string) => void; commit: (message: string) => string } {
  const dir = mkdtempSync(join(tmpdir(), "gb-secrets-"));
  repos.push(dir);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env: ENV, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  return {
    dir,
    git,
    write: (file, text) => writeFileSync(join(dir, file), text),
    commit: (message) => {
      git("add", "-A");
      git("-c", "commit.gpgsign=false", "commit", "-q", "-m", message);
      return git("rev-parse", "HEAD");
    },
  };
}

describe("git history", () => {
  it("finds a secret deleted from the files, at the commit that added it", async () => {
    const r = repo();
    r.write("README.md", "hello\n");
    r.commit("init");
    r.write("config.js", `const a = 1;\nconst token = "${GH}";\n`);
    const added = r.commit("add config");
    r.write("config.js", "const a = 1;\nconst b = 2;\nconst token = process.env.TOKEN;\n");
    r.commit("move token to env");

    expect(scanDirectory(r.dir).findings).toEqual([]);
    const result = await scanGit({ cwd: r.dir, mode: "history" });
    expect(result.scannedCommits).toBe(3);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ patternId: "github_pat", file: "config.js", line: 2, commit: added, author: "Ayşe" });
    expect(JSON.stringify(result.findings)).not.toContain(GH);
  });

  it("reports a secret once, at its first commit, even when a later commit adds it again", async () => {
    const r = repo();
    r.write("a.env", `TOKEN=${GH}\n`);
    const first = r.commit("add");
    r.write("a.env", "TOKEN=\n");
    r.commit("remove");
    r.write("a.env", `# back again\nTOKEN=${GH}\n`);
    r.commit("re-add");
    const result = await scanGit({ cwd: r.dir, mode: "history" });
    expect(result.findings.map((f) => f.commit)).toEqual([first]);
  });

  it("skips the same directories as a directory scan (a vendored node_modules)", async () => {
    const r = repo();
    execFileSync("mkdir", ["-p", join(r.dir, "node_modules/lib")]);
    r.write("node_modules/lib/fixture.js", `const t = "${GH}";\n`);
    r.write("app.env", `TOKEN=${GH2}\n`);
    r.commit("vendored deps");
    const result = await scanGit({ cwd: r.dir, mode: "history" });
    expect(result.findings.map((f) => f.file)).toEqual(["app.env"]);
  });

  it("limits history to a range and refuses a range that looks like an option", async () => {
    const r = repo();
    r.write("old.env", `TOKEN=${GH}\n`);
    r.commit("old");
    r.write("new.env", `TOKEN=${GH2}\n`);
    r.commit("new");
    const recent = await scanGit({ cwd: r.dir, mode: "history", range: "HEAD~1..HEAD" });
    expect(recent.findings.map((f) => f.file)).toEqual(["new.env"]);
    await expect(scanGit({ cwd: r.dir, mode: "history", range: "--output=/tmp/x" })).rejects.toThrow(/Invalid revision range/);
  });
});

describe("staged", () => {
  it("scans only lines added in the index, with their line numbers", async () => {
    const r = repo();
    r.write("app.env", `OLD=${GH}\n`);
    r.commit("existing secret");
    r.write("app.env", `OLD=${GH}\nNAME=demo\nNEW=${GH2}\n`);
    r.git("add", "app.env");
    r.write("unstaged.env", `X=${GH2}\n`);

    const result = await scanGit({ cwd: r.dir, mode: "staged" });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ file: "app.env", line: 3, column: 5, patternId: "github_pat" });
    expect(result.findings[0]!.commit).toBeUndefined();
  });
});

describe("fingerprints and baselines", () => {
  it("fingerprints survive line moves, differ per file, and never hold the secret", () => {
    const before = scanText(`TOKEN=${GH}\n`, "a.env")[0]!;
    const after = scanText(`# moved\n\n\nTOKEN=${GH}\n`, "a.env")[0]!;
    expect(after.line).not.toBe(before.line);
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(scanText(`TOKEN=${GH}\n`, "b.env")[0]!.fingerprint).not.toBe(before.fingerprint);
    expect(fingerprintOf("github_pat", "dir\\a.env", GH)).toBe(fingerprintOf("github_pat", "dir/a.env", GH));
  });

  it("a directory scan fingerprints paths relative to the scan root", () => {
    const r = repo();
    r.write("x.env", `TOKEN=${GH}\n`);
    expect(scanDirectory(r.dir).findings[0]!.fingerprint).toBe(fingerprintOf("github_pat", "x.env", GH));
  });

  it("a baseline hides known findings and keeps new ones", () => {
    const r = repo();
    const path = join(r.dir, "baseline.json");
    writeBaseline(path, scanText(`TOKEN=${GH}\n`, "a.env"));
    expect(readFileSync(path, "utf8")).not.toContain(GH);

    const later = [...scanText(`# edited\nTOKEN=${GH}\n`, "a.env"), ...scanText(`TOKEN=${GH2}\n`, "b.env")];
    const applied = applyBaseline(later, readBaseline(path));
    expect(applied.suppressed).toBe(1);
    expect(applied.findings.map((f) => f.file)).toEqual(["b.env"]);
  });

  it("refuses a file that is not a baseline", () => {
    const r = repo();
    const path = join(r.dir, "nope.json");
    writeFileSync(path, "{}");
    expect(() => readBaseline(path)).toThrow(/not a GuardBee secrets baseline/);
    unlinkSync(path);
  });

  it("dedupes baseline entries and puts fingerprints in SARIF", () => {
    const findings = [...scanText(`A=${GH}\n`, "a.env"), ...scanText(`A=${GH}\n`, "a.env")];
    expect(toBaseline(findings).findings).toHaveLength(1);
    const sarif = buildSarif("0.0.0", findings) as { runs: { results: { partialFingerprints: Record<string, string> }[] }[] };
    expect(sarif.runs[0]!.results[0]!.partialFingerprints).toEqual({ "guardbeeSecret/v1": findings[0]!.fingerprint });
  });
});

describe("CLI", () => {
  const cli = resolve(__dirname, "../../dist/cli.js");
  const run = (cwd: string, ...args: string[]) => spawnSync("node", [cli, "scan", ...args], { cwd, encoding: "utf8", env: { ...ENV, GUARDBEE_TELEMETRY: "0" } });

  it("adopts a repo with --write-baseline, then fails only on a new secret", () => {
    const r = repo();
    r.write("old.env", `TOKEN=${GH}\n`);
    r.commit("old secret");

    expect(run(r.dir, ".", "--history").status).toBe(1);
    expect(run(r.dir, ".", "--history", "--write-baseline=.guardbee-secrets-baseline.json").status).toBe(0);
    expect(run(r.dir, ".", "--history", "--baseline=.guardbee-secrets-baseline.json").status).toBe(0);

    r.write("new.env", `TOKEN=${GH2}\n`);
    r.git("add", "new.env");
    const staged = run(r.dir, "--staged", "--baseline=.guardbee-secrets-baseline.json", "--format=json");
    expect(staged.status).toBe(1);
    expect((JSON.parse(staged.stdout) as { findings: { file: string }[] }).findings.map((f) => f.file)).toEqual(["new.env"]);
  });
});
