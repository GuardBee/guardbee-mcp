import { spawn } from "child_process";
import { createInterface } from "readline";
import { extname } from "path";
import { scanText, SKIP_DIRS, SKIP_EXTENSIONS, type Finding } from "./scanner.js";

export interface GitScanOptions {
  /** A directory inside the repository. */
  cwd: string;
  /** `staged`: lines added in the index (pre-commit). `history`: lines added by every commit in `range`. */
  mode: "staged" | "history";
  /** Revision range for history, e.g. `main..HEAD` or `v1.0.0..`; default: all refs. */
  range?: string;
  maxCommits?: number;
}

export interface GitScanResult {
  scannedCommits: number;
  scannedHunks: number;
  totalFindings: number;
  findings: Finding[];
  durationMs: number;
}

const COMMIT_MARK = "\u0000commit ";

/** The directory scan's skip rules, so a vendored node_modules in history is not reported either. */
function skipped(file: string): boolean {
  if (SKIP_EXTENSIONS.has(extname(file).toLowerCase())) return true;
  return file.split("/").slice(0, -1).some((dir) => SKIP_DIRS.has(dir));
}
const MAX_HUNK_BYTES = 1024 * 1024;

/** Lines of a git command's stdout, streamed; rejects with git's stderr on failure. */
async function* gitLines(cwd: string, args: string[]): AsyncGenerator<string> {
  // quotePath=false: paths with non-ASCII characters come out as they are
  const child = spawn("git", ["-c", "core.quotePath=false", ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  const exited = new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
  for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) yield line;
  const code = await exited;
  if (code !== 0) throw new Error(`git ${args[0]} failed: ${stderr.trim() || `exit ${code}`}`);
}

function gitArgs(options: GitScanOptions): string[] {
  const diff = ["-U0", "--no-color", "--no-ext-diff", "--diff-filter=ACMR"];
  if (options.mode === "staged") return ["diff", "--cached", ...diff];
  const range = options.range ?? "--all";
  // A range that starts with "-" would be read as an option
  if (options.range !== undefined && (options.range.startsWith("-") || !/^[\w./~^@{}:-]+$/.test(options.range))) {
    throw new Error(`Invalid revision range: ${options.range}`);
  }
  return [
    "log",
    "-p",
    ...diff,
    `--format=${COMMIT_MARK.replace("\u0000", "%x00")}%H%x09%an%x09%aI`,
    ...(options.maxCommits ? ["-n", String(options.maxCommits)] : []),
    range,
    "--",
  ];
}

/**
 * Scan only what git says was added: staged lines before a commit, or every
 * commit's added lines in history. Each hunk's added lines are scanned as one
 * block, so a multi-line private key is still one match. In history the same
 * secret in the same file is reported once, at the commit that added it.
 */
export async function scanGit(options: GitScanOptions): Promise<GitScanResult> {
  const start = Date.now();
  const byFingerprint = new Map<string, Finding>();
  const ordered: Finding[] = [];
  let commit: { hash: string; author: string; date: string } | undefined;
  let file: string | null = null;
  let block: string[] = [];
  let blockStart = 0;
  let blockBytes = 0;
  let scannedCommits = 0;
  let scannedHunks = 0;

  const flush = () => {
    if (file && block.length > 0 && !skipped(file)) {
      scannedHunks++;
      for (const finding of scanText(block.join("\n"), file, file)) {
        const located: Finding = {
          ...finding,
          line: finding.line + blockStart - 1,
          ...(commit ? { commit: commit.hash, author: commit.author, date: commit.date } : {}),
        };
        if (options.mode === "history") {
          // git log runs newest first: the last sighting is the commit that added it
          byFingerprint.set(located.fingerprint, located);
        } else {
          ordered.push(located);
        }
      }
    }
    block = [];
    blockBytes = 0;
  };

  for await (const line of gitLines(options.cwd, gitArgs(options))) {
    if (line.startsWith(COMMIT_MARK)) {
      flush();
      const [hash = "", author = "", date = ""] = line.slice(COMMIT_MARK.length).split("\t");
      commit = { hash, author, date };
      scannedCommits++;
    } else if (line.startsWith("diff --git ")) {
      flush();
      file = null;
    } else if (line.startsWith("+++ ")) {
      const target = line.slice(4);
      file = target === "/dev/null" ? null : target.replace(/^b\//, "");
    } else if (line.startsWith("@@ ")) {
      flush();
      const added = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      blockStart = added ? Number(added[1]) : 1;
    } else if (line.startsWith("+") && file) {
      if (blockBytes < MAX_HUNK_BYTES) {
        block.push(line.slice(1));
        blockBytes += line.length;
      }
    }
  }
  flush();

  const findings = options.mode === "history" ? [...byFingerprint.values()] : ordered;
  return {
    scannedCommits: options.mode === "history" ? scannedCommits : 0,
    scannedHunks,
    totalFindings: findings.length,
    findings,
    durationMs: Date.now() - start,
  };
}
