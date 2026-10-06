#!/usr/bin/env node
import { startServer } from "./server.js";
import {
  buildEvent,
  buildSarif,
  evaluateEvent,
  getEngine,
  listLoadedRules,
  readTextFile,
  ruleStats,
  shouldFail,
  type Lane,
} from "./engine.js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
function getVersion(): string {
  try {
    return (JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as { version: string })
      .version;
  } catch {
    return "0.0.0";
  }
}

function printHelp(): void {
  console.log(`@guardbee/mcp-threat-rules v${getVersion()}

Usage (MCP server):
  guardbee-threat-rules [serve]

Usage (CLI):
  guardbee-threat-rules eval <text|->     Evaluate text against ATR + GuardBee rules
  guardbee-threat-rules scan <file>       Evaluate a file
  guardbee-threat-rules list              List rules
  guardbee-threat-rules stats             Rule counts by category/source

Options:
  --lane=enforce|alert|hunt
  --format=text|json|sarif
  --fail-on=any|critical|high|medium|none
  --category=<atr-category>
  --source=atr|guardbee
  --type=llm_input|llm_output|tool_call|...
`);
}

function argValue(args: string[], name: string): string | undefined {
  return args.find((a) => a.startsWith(`${name}=`))?.split("=").slice(1).join("=");
}

const [, , firstArg, ...rest] = process.argv;

if (!firstArg || firstArg === "serve") {
  startServer().catch((err) => {
    process.stderr.write(
      `[guardbee-threat-rules] ${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(1);
  });
} else if (firstArg === "--help" || firstArg === "-h") {
  printHelp();
} else if (firstArg === "eval" || firstArg === "scan") {
  const lane = (argValue(rest, "--lane") ?? "hunt") as Lane;
  const format = argValue(rest, "--format") ?? "text";
  const failOn = (argValue(rest, "--fail-on") ?? "any") as
    | "any"
    | "critical"
    | "high"
    | "medium"
    | "none";
  const type = argValue(rest, "--type") as Parameters<typeof buildEvent>[0]["type"] | undefined;
  const target = rest.find((a) => !a.startsWith("--"));
  const run = async () => {
    let content = "";
    if (firstArg === "scan") {
      if (!target) {
        console.error("Usage: guardbee-threat-rules scan <file>");
        process.exit(2);
      }
      content = readTextFile(target);
    } else {
      content = target ?? "";
      if (!content || content === "-") content = readFileSync(0, "utf8");
    }
    const { engine, atrRuleCount, guardbeeRuleCount } = await getEngine(lane);
    const result = evaluateEvent(engine, buildEvent({ content, type }), {
      atrRuleCount,
      guardbeeRuleCount,
    });
    if (format === "json") console.log(JSON.stringify(result, null, 2));
    else if (format === "sarif") console.log(JSON.stringify(buildSarif(getVersion(), result), null, 2));
    else {
      console.log(
        `matches=${result.matchCount} highest=${result.highestSeverity ?? "none"} (${result.durationMs}ms) atr=${result.atrRuleCount} guardbee=${result.guardbeeRuleCount}`
      );
      for (const m of result.matches) {
        console.log(`[${m.severity}] ${m.ruleId} (${m.source}) ${m.title}`);
      }
    }
    process.exit(shouldFail(result, failOn) ? 1 : 0);
  };
  run().catch((err) => {
    console.error("Error:", (err as Error).message);
    process.exit(2);
  });
} else if (firstArg === "list") {
  const lane = (argValue(rest, "--lane") ?? "hunt") as Lane;
  const category = argValue(rest, "--category");
  const source = argValue(rest, "--source") as "atr" | "guardbee" | undefined;
  getEngine(lane)
    .then(({ engine }) => {
      let rules = listLoadedRules(engine, category);
      if (source) rules = rules.filter((r) => r.source === source);
      console.log(JSON.stringify({ count: rules.length, rules }, null, 2));
    })
    .catch((err) => {
      console.error("Error:", (err as Error).message);
      process.exit(2);
    });
} else if (firstArg === "stats") {
  const lane = (argValue(rest, "--lane") ?? "hunt") as Lane;
  getEngine(lane)
    .then(({ engine }) => {
      console.log(JSON.stringify(ruleStats(engine), null, 2));
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
