#!/usr/bin/env node
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { buildSarif, formatResults, shouldFail } from "./report.js";
import { scanDirectory } from "./scanner.js";
import { startServer } from "./server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
function getVersion(): string {
  try {
    return (JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

function printHelp(): void {
  console.log(`@guardbee/mcp-document-scanner

Usage (MCP server):
  guardbee-document-scanner [serve]

Usage (CLI):
  guardbee-document-scanner scan <file|folder> [options]

Options:
  --format=<fmt>        text (default) | json | sarif
  --fail-on=<level>     any (default) | critical | high | medium | low | none
  --no-ocr              Read text layers only
  --lang=<l1,l2>        Tesseract languages (default tur,eng)
  --lang-path=<dir>     Folder with <lang>.traineddata, for offline OCR
  --include=<d1,d2>     Opt-in detectors: ip_address, mac_address, plate_tr
  --max-pages=<n>       PDF pages read per document (default 50)
  --max-files=<n>       Files scanned in a folder (default 500)
  --text                Also scan .txt, .md and .csv files in a folder

OCR needs the optional packages tesseract.js (images) and @napi-rs/canvas (scanned PDFs).

Exit codes: 0 nothing at or above --fail-on, 1 found, 2 error`);
}

async function runScan(args: string[]): Promise<void> {
  const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const target = args.find((a) => !a.startsWith("--"));
  if (!target) {
    printHelp();
    process.exit(2);
  }
  const format = flag("format") ?? "text";
  const list = (value: string | undefined) => value?.split(",").map((s) => s.trim()).filter(Boolean);
  const result = await scanDirectory(target, {
    ocr: !args.includes("--no-ocr"),
    includeText: args.includes("--text"),
    ...(list(flag("lang")) ? { languages: list(flag("lang"))! } : {}),
    ...(flag("lang-path") ? { langPath: flag("lang-path")! } : {}),
    ...(list(flag("include")) ? { include: list(flag("include"))! } : {}),
    ...(flag("max-pages") ? { maxPages: Number(flag("max-pages")) } : {}),
    ...(flag("max-files") ? { maxFiles: Number(flag("max-files")) } : {}),
  });
  if (format === "json") console.log(JSON.stringify(result, null, 2));
  else if (format === "sarif") console.log(JSON.stringify(buildSarif(getVersion(), result.findings), null, 2));
  else console.log(formatResults(result.documents, result.durationMs));
  process.exit(shouldFail(result.findings, flag("fail-on") ?? "any") ? 1 : 0);
}

const [, , command, ...rest] = process.argv;
if (!command || command === "serve") {
  startServer(getVersion()).catch((err) => {
    process.stderr.write(`[guardbee-document-scanner] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
} else if (command === "--help" || command === "-h") {
  printHelp();
} else if (command === "scan") {
  runScan(rest).catch((err) => {
    console.error("Error:", err instanceof Error ? err.message : String(err));
    process.exit(2);
  });
} else {
  printHelp();
  process.exit(2);
}
