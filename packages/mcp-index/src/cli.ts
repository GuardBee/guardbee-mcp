#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { crawl, type OptOut } from "./crawl.js";
import { sigstoreVerifier } from "./sigstore.js";
import { writeSite } from "./site.js";

const HELP = `guardbee-mcp-index crawl --out <dir> [--limit N] [--only name,name] [--concurrency N] [--optout optout.json]

Grades every server in the official MCP Registry and writes the static site
(index/v1.json, badges/, index.html, RUBRIC.md) to <dir>.`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "crawl" || args.includes("--help")) {
    console.log(HELP);
    process.exit(command === undefined || args.includes("--help") ? 0 : 1);
  }
  const out = flag(args, "--out");
  if (!out) throw new Error("--out is required");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const optOutFile = flag(args, "--optout") ?? path.join(here, "..", "optout.json");
  const optOut = fs.existsSync(optOutFile) ? (JSON.parse(fs.readFileSync(optOutFile, "utf8")) as OptOut[]) : [];
  const limit = flag(args, "--limit");
  const only = flag(args, "--only");
  const started = Date.now();
  const index = await crawl({
    fetch: (url, init) => fetch(url, init),
    verifyBundle: sigstoreVerifier(),
    optOut,
    concurrency: Number(flag(args, "--concurrency") ?? 6),
    ...(limit ? { limit: Number(limit) } : {}),
    ...(only ? { only: only.split(",") } : {}),
    onProgress: (done, total, entry) => {
      if (done % 50 === 0 || done === total || process.env["MCP_INDEX_VERBOSE"]) process.stderr.write(`[${done}/${total}] ${entry.name}: ${entry.grade ?? `– (${entry.note})`}\n`);
    },
  });
  writeSite(index, out, fs.readFileSync(path.join(here, "..", "RUBRIC.md"), "utf8"));
  const graded = index.servers.filter((s) => s.grade);
  const counts = Object.fromEntries(["A", "B", "C", "D", "F"].map((g) => [g, graded.filter((s) => s.grade === g).length]));
  process.stderr.write(`${index.servers.length} servers, ${graded.length} graded ${JSON.stringify(counts)} in ${Math.round((Date.now() - started) / 1000)}s → ${out}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
