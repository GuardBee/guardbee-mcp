#!/usr/bin/env node
import { startServer } from "./server.js";
import { buildEvent, evaluateEvent, getEngine, listLoadedRules } from "./engine.js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
function getVersion(): string {
  try {
    return (JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

function printHelp(): void {
  console.log(`@guardbee/mcp-threat-rules v${getVersion()}

Usage (MCP server):
  guardbee-threat-rules [serve]

Usage (CLI):
  guardbee-threat-rules eval <text|->     Evaluate text against ATR
  guardbee-threat-rules list [--category=prompt-injection]

Options:
  --lane=enforce|alert|hunt   Detection lane (default: hunt)
  --format=text|json
`);
}

const [, , firstArg, ...rest] = process.argv;

if (!firstArg || firstArg === "serve") {
  startServer().catch((err) => {
    process.stderr.write(`[guardbee-threat-rules] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
} else if (firstArg === "--help" || firstArg === "-h") {
  printHelp();
} else if (firstArg === "eval") {
  const laneArg = rest.find((a) => a.startsWith("--lane="))?.split("=")[1] ?? "hunt";
  const format = rest.find((a) => a.startsWith("--format="))?.split("=")[1] ?? "text";
  const textArg = rest.find((a) => !a.startsWith("--"));
  const run = async () => {
    let content = textArg ?? "";
    if (!content || content === "-") {
      content = readFileSync(0, "utf8");
    }
    const engine = await getEngine(laneArg as "hunt" | "alert" | "enforce");
    const result = evaluateEvent(engine, buildEvent({ content }));
    if (format === "json") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`matches=${result.matchCount} highest=${result.highestSeverity ?? "none"} (${result.durationMs}ms)`);
      for (const m of result.matches) {
        console.log(`[${m.severity}] ${m.ruleId} ${m.title}`);
      }
    }
    process.exit(result.matchCount > 0 ? 1 : 0);
  };
  run().catch((err) => {
    console.error("Error:", (err as Error).message);
    process.exit(2);
  });
} else if (firstArg === "list") {
  const laneArg = rest.find((a) => a.startsWith("--lane="))?.split("=")[1] ?? "hunt";
  const category = rest.find((a) => a.startsWith("--category="))?.split("=")[1];
  getEngine(laneArg as "hunt" | "alert" | "enforce")
    .then((engine) => {
      const rules = listLoadedRules(engine, category);
      console.log(JSON.stringify({ count: rules.length, rules }, null, 2));
    })
    .catch((err) => {
      console.error("Error:", (err as Error).message);
      process.exit(2);
    });
} else {
  console.error(`Unknown command: ${firstArg}`);
  printHelp();
  process.exit(2);
}
