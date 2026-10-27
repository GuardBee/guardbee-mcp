import { callSpan, extractSourceTools, mentionsInput, type SourceTool } from "@guardbee/guard-core";
import type { McpAuditPattern } from "./patterns.js";

/**
 * Tool input reaching a dangerous call in Python and Go handlers.
 *
 * The regex patterns in patterns.ts only see input under its conventional
 * names (`args.x`, `arguments["x"]`). A FastMCP tool's input is its
 * function parameters, an official go-sdk tool's is its typed-args
 * parameter, an mcp-go tool's is whatever `request.RequireString(...)` was
 * assigned to. This reads those names from the tool definition, follows
 * them through plain assignments in the handler, and reports a sink call
 * whose arguments mention one.
 */

export interface FlowFinding {
  patternId: string;
  patternName: string;
  category: McpAuditPattern["category"];
  severity: McpAuditPattern["severity"];
  owasp?: string;
  recommendation: string;
  index: number;
  match: string;
}

interface Sink {
  id: string;
  name: string;
  category: McpAuditPattern["category"];
  severity: McpAuditPattern["severity"];
  owasp?: string;
  /** The callee; the match starts at the call. */
  callee: RegExp;
  /** Which part of the call carries the dangerous value: the whole argument list, the first argument, or the object a method is called on. */
  argument: "any" | "first" | "receiver";
  /** Extra condition on the call text (e.g. a write mode for open()). */
  when?: RegExp;
  /** The input must sit in a string built by interpolation or concatenation (SQL). */
  built?: boolean;
  /** Handler code that shows the value is checked (a base-directory or host allowlist). */
  guardedBy?: RegExp;
  /** Severity when `when` does not hold (e.g. exec.Command without a shell). */
  otherwise?: { severity: McpAuditPattern["severity"]; name: string };
  recommendation: string;
}

const SHELL_REC =
  "A tool parameter reaches a shell/process call. Any caller of this tool — including a prompt-injected LLM upstream — can run commands. Pass a fixed command with an argument list (no shell), and check the parameter against an allowlist.";
const EVAL_REC = "A tool parameter is evaluated as code: remote code execution for any caller of the tool. Parse and validate it as data instead.";
const FS_REC =
  "A path taken from tool input is written or deleted with no visible base-directory check — a caller can pass '../' paths (path traversal). Resolve the path and verify it stays inside an allowed directory first.";
const SSRF_REC =
  "A request URL taken from tool input, with no visible host allowlist, lets a caller make this server fetch internal addresses (SSRF), e.g. a cloud metadata endpoint. Check the host against an allowlist before the request.";
const SQL_REC = "A SQL statement is built by formatting tool input into the query text — SQL injection reachable by anyone who can call the tool. Use parameterized queries.";

const PATH_GUARD = /\bis_relative_to\(|\bcommonpath\(|\.parents\b|\bfilepath\.Rel\(|\bfilepath\.IsLocal\(|\bstrings\.HasPrefix\(|\bsecure_filename\(|\bos\.Root\b|\bOpenInRoot\(/;
const HOST_GUARD = /\b(?:allow(?:ed)?_?(?:hosts?|domains?|list)|ALLOWED_\w+|allowlist|whitelist)\b/i;

const PYTHON_SINKS: Sink[] = [
  {
    id: "python_shell_from_tool_input",
    name: "Python tool handler passes tool input into subprocess/os.system",
    category: "excessive-agency",
    severity: "critical",
    owasp: "MCP05:2025",
    callee: /\b(?:subprocess\.(?:run|call|Popen|check_output|check_call|getoutput|getstatusoutput)|os\.(?:system|popen)|asyncio\.create_subprocess_(?:shell|exec))\s*\(/g,
    argument: "any",
    recommendation: SHELL_REC,
  },
  {
    id: "python_eval_of_tool_input",
    name: "Python tool handler eval/exec's tool input",
    category: "excessive-agency",
    severity: "critical",
    owasp: "MCP05:2025",
    callee: /(?<![\w.])(?:eval|exec)\s*\(/g,
    argument: "first",
    recommendation: EVAL_REC,
  },
  {
    id: "python_fs_write_from_tool_input",
    name: "Python tool handler writes or deletes a path taken from tool input",
    category: "unsafe-input",
    severity: "high",
    callee: /\bopen\s*\(|\bos\.(?:remove|unlink|rmdir|removedirs|rename|replace)\s*\(|\bshutil\.(?:rmtree|move)\s*\(/g,
    argument: "first",
    when: /^(?!open\b)|,\s*(?:mode\s*=\s*)?["'][rb]?[wax]b?\+?["']/,
    guardedBy: PATH_GUARD,
    recommendation: FS_REC,
  },
  {
    id: "python_fs_write_from_tool_input",
    name: "Python tool handler writes or deletes a path taken from tool input",
    category: "unsafe-input",
    severity: "high",
    // Path(base / name).write_text(...), Path(p).unlink()
    callee: /\.(?:write_text|write_bytes|unlink|rmdir)\s*\(/g,
    argument: "receiver",
    guardedBy: PATH_GUARD,
    recommendation: FS_REC,
  },
  {
    id: "python_ssrf_from_tool_input",
    name: "Python HTTP client URL comes from tool input",
    category: "unsafe-input",
    severity: "high",
    callee: /\b(?:requests|httpx|session|client|\w+_client)\.(?:get|post|put|patch|delete|head|request|stream)\s*\(|\burlopen\s*\(/g,
    argument: "first",
    guardedBy: HOST_GUARD,
    recommendation: SSRF_REC,
  },
  {
    id: "python_sql_injection_via_tool_input",
    name: "Python SQL built with f-string / % formatting of tool input",
    category: "unsafe-input",
    severity: "critical",
    owasp: "MCP05:2025",
    callee: /\.(?:execute|executemany|executescript)\s*\(/g,
    argument: "first",
    built: true,
    recommendation: SQL_REC,
  },
];

const GO_SINKS: Sink[] = [
  {
    id: "go_shell_from_tool_input",
    name: "Go tool handler passes tool input to a shell (exec.Command sh -c)",
    category: "excessive-agency",
    severity: "critical",
    owasp: "MCP05:2025",
    callee: /\bexec\.Command(?:Context)?\s*\(/g,
    argument: "any",
    when: /"(?:sh|bash|zsh|\/bin\/sh|\/bin\/bash|cmd|cmd\.exe|powershell|pwsh)"\s*,\s*"(?:-c|\/c|-Command)"/,
    otherwise: { severity: "high", name: "Go tool handler passes tool input as a process argument (exec.Command)" },
    recommendation: SHELL_REC,
  },
  {
    id: "go_fs_write_from_tool_input",
    name: "Go tool handler writes or deletes a path taken from tool input",
    category: "unsafe-input",
    severity: "high",
    callee: /\b(?:os|ioutil)\.(?:WriteFile|Remove|RemoveAll|Rename|Create|Truncate|OpenFile)\s*\(/g,
    argument: "first",
    when: /^(?!os\.OpenFile)|O_(?:WRONLY|RDWR|CREATE|APPEND|TRUNC)/,
    guardedBy: PATH_GUARD,
    recommendation: FS_REC,
  },
  {
    id: "go_ssrf_from_tool_input",
    name: "Go HTTP request URL comes from tool input",
    category: "unsafe-input",
    severity: "high",
    callee: /\bhttp\.(?:Get|Head|Post|PostForm|NewRequest|NewRequestWithContext)\s*\(|\b\w*[cC]lient\.(?:Get|Head|Post)\s*\(/g,
    argument: "any",
    guardedBy: HOST_GUARD,
    recommendation: SSRF_REC,
  },
  {
    id: "go_sql_injection_via_tool_input",
    name: "Go SQL built with fmt.Sprintf / concatenation of tool input",
    category: "unsafe-input",
    severity: "critical",
    owasp: "MCP05:2025",
    callee: /\.(?:Query|QueryRow|Exec|QueryContext|QueryRowContext|ExecContext)\s*\(/g,
    argument: "any",
    built: true,
    recommendation: SQL_REC,
  },
];

const SHELL_TOOL_NAME = /^(?:run_shell|execute_command|run_command|execute_shell|eval_code|execute_code|run_script|shell_exec|run_sql|execute_sql|run_query)$/i;

/** Arguments of a call span: the text inside its outer parentheses. */
function argumentsOf(span: string): string {
  const open = span.indexOf("(");
  return span.slice(open + 1, -1);
}

/** Top-level arguments of an argument list. */
function splitArguments(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i]!;
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      out.push(args.slice(from, i));
      from = i + 1;
    }
  }
  out.push(args.slice(from));
  return out;
}

const firstArgument = (args: string) => splitArguments(args)[0] ?? "";

/** Input names plus the variables assigned from them in the handler (two rounds: `a = f(x)`, `b = a + y`). */
function propagate(code: string, inputs: string[], language: "python" | "go"): string[] {
  const names = new Set(inputs);
  const assign =
    language === "python"
      ? /^[ \t]*([A-Za-z_]\w*)(?:\s*:\s*[^=\n]+)?\s*(?:\+)?=(?!=)\s*(.+)$/gm
      : /^[ \t]*([A-Za-z_]\w*)(?:\s*,\s*[A-Za-z_]\w*)*\s*:?=(?!=)\s*(.+)$/gm;
  for (let round = 0; round < 2; round++) {
    for (const m of code.matchAll(assign)) {
      if (mentionsInput(m[2]!, [...names])) names.add(m[1]!);
    }
  }
  return [...names];
}

/** The value is formatted into a string: an f-string / %-format / .format / + in Python, fmt.Sprintf / + in Go. */
function builtFrom(args: string, inputs: string[], language: "python" | "go"): boolean {
  if (language === "python") {
    const fstring = /\b[fF][rR]?(["'])(?:(?!\1).)*\{([^}]*)\}/g;
    for (const m of args.matchAll(fstring)) if (mentionsInput(m[2]!, inputs)) return true;
  }
  // Python's query is the first argument; Go's comes after a context
  const candidates = language === "python" ? [firstArgument(args)] : splitArguments(args);
  const formatted = language === "python" ? /["']\s*(?:%|\+)|\.format\s*\(|\+\s*["']/ : /\bfmt\.Sprintf\s*\(|"\s*\+|\+\s*"/;
  return candidates.some((arg) => mentionsInput(arg, inputs) && formatted.test(arg));
}

function lineAround(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index - 1) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end < 0 ? text.length : end).trim();
}

export function checkToolInputFlows(text: string, language: "python" | "go"): FlowFinding[] {
  const findings: FlowFinding[] = [];
  const sinks = language === "python" ? PYTHON_SINKS : GO_SINKS;
  const tools: SourceTool[] = extractSourceTools(text, language);

  for (const tool of tools) {
    if (SHELL_TOOL_NAME.test(tool.name)) {
      findings.push({
        patternId: language === "python" ? "python_unrestricted_shell_tool_name" : "unrestricted_shell_tool_name",
        patternName: "Tool name grants shell/arbitrary code or SQL execution",
        category: "excessive-agency",
        severity: "high",
        owasp: "MCP05:2025",
        recommendation:
          "A tool named like this typically hands the calling LLM arbitrary shell/code/SQL execution. If intentional, gate it behind an explicit opt-in config flag (off by default) and a strict allowlist.",
        index: tool.index,
        match: `tool "${tool.name}"`,
      });
    }

    for (const [start, end] of tool.handler) {
      const code = text.slice(start, end);
      const inputs = propagate(code, tool.inputs, language);
      if (inputs.length === 0) continue;
      for (const sink of sinks) {
        if (sink.guardedBy?.test(code)) continue;
        const callee = new RegExp(sink.callee.source, "g");
        for (const m of code.matchAll(callee)) {
          const span = callSpan(code, m.index!, language);
          const args = argumentsOf(span);
          const checked =
            sink.argument === "first" ? firstArgument(args) : sink.argument === "receiver" ? code.slice(code.lastIndexOf("\n", m.index!) + 1, m.index!) : args;
          const input = mentionsInput(checked, inputs);
          if (!input) continue;
          if (sink.built && !builtFrom(args, inputs, language)) continue;
          const holds = !sink.when || sink.when.test(span);
          if (!holds && !sink.otherwise) continue;
          findings.push({
            patternId: sink.id,
            patternName: holds ? sink.name : sink.otherwise!.name,
            category: sink.category,
            severity: holds ? sink.severity : sink.otherwise!.severity,
            owasp: sink.owasp,
            recommendation: sink.recommendation,
            index: start + m.index!,
            match: `tool "${tool.name}": ${lineAround(code, m.index!).slice(0, 200)} (input: ${input})`,
          });
        }
      }
    }
  }
  return findings;
}
