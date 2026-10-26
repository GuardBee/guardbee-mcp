/**
 * MCP tool definitions read out of Python and Go server source, for the
 * static scanners (tool poisoning, server auditor, OAuth auditor).
 *
 * Like the TypeScript side of those scanners this is a bounded lexical
 * reading, not a parser: it knows the registration shapes of the official
 * Python SDK / FastMCP (`@mcp.tool()`, low-level `types.Tool(...)` +
 * `@server.call_tool()`), the official Go SDK (`mcp.AddTool(s, &mcp.Tool{...}, h)`)
 * and mark3labs/mcp-go (`mcp.NewTool("name", mcp.WithDescription(...))` +
 * `s.AddTool(tool, h)`), and reads strings, brackets and comments well
 * enough to find a tool's name, description, parameter descriptions and the
 * code that handles it. Indexes are offsets into the scanned text.
 */

export type SourceLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "kotlin"
  | "csharp"
  | "ruby"
  | "php"
  | "swift"
  | "other";

/** How much of the static analysis applies to a language. */
export type AnalysisDepth =
  /** Tool definitions, descriptions, handler sinks and OAuth checks. */
  | "full"
  /** Language-neutral rules only (secrets, URLs, config); no tool or handler analysis. */
  | "patterns";

const EXTENSIONS: Record<string, SourceLanguage> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
};

/** Source language of a file by extension; undefined for files that are not code (docs, config, data). */
export function languageOf(path: string): SourceLanguage | undefined {
  const dot = path.lastIndexOf(".");
  if (dot < 0 || dot < path.lastIndexOf("/")) return undefined;
  return EXTENSIONS[path.slice(dot).toLowerCase()];
}

export const ANALYSIS_DEPTH: Record<SourceLanguage, AnalysisDepth> = {
  typescript: "full",
  javascript: "full",
  python: "full",
  go: "full",
  rust: "patterns",
  java: "patterns",
  kotlin: "patterns",
  csharp: "patterns",
  ruby: "patterns",
  php: "patterns",
  swift: "patterns",
  other: "patterns",
};

export interface TextSpan {
  text: string;
  index: number;
}

export interface SourceTool {
  name: string;
  /** Where the registration starts. */
  index: number;
  description: TextSpan | null;
  /** Parameter descriptions and other schema strings the model reads. */
  schemaStrings: TextSpan[];
  /** The tool declares readOnlyHint: true. */
  readOnlyHint: boolean;
  /** Names that carry tool input inside the handler (parameters, argument variables). */
  inputs: string[];
  /** Code that runs when the tool is called: [start, end) offsets. */
  handler: Array<[number, number]>;
}

const MAX_SPAN = 4000;

// ── Lexing helpers ──────────────────────────────────────────────────────────

/** A Python string literal starting at `i` (prefix letters allowed); content offsets are inside the quotes. */
function pyStringAt(text: string, i: number): { value: string; index: number; end: number } | null {
  const m = /^([rRbBuUfF]{0,2})("""|'''|"|')/.exec(text.slice(i, i + 5));
  if (!m) return null;
  const quote = m[2]!;
  const raw = /r/i.test(m[1]!);
  const start = i + m[0].length;
  let j = start;
  const limit = Math.min(text.length, start + MAX_SPAN);
  while (j < limit) {
    if (text[j] === "\\" && !raw) {
      j += 2;
      continue;
    }
    if (text.startsWith(quote, j)) return { value: text.slice(start, j), index: start, end: j + quote.length };
    if (quote.length === 1 && text[j] === "\n") return null;
    j++;
  }
  return null;
}

/** A Go interpreted ("...") or raw (`...`) string literal starting at `i`. */
function goStringAt(text: string, i: number): { value: string; index: number; end: number } | null {
  const quote = text[i];
  if (quote !== '"' && quote !== "`") return null;
  const start = i + 1;
  const limit = Math.min(text.length, start + MAX_SPAN);
  for (let j = start; j < limit; j++) {
    if (quote === '"' && text[j] === "\\") {
      j++;
      continue;
    }
    if (text[j] === quote) return { value: text.slice(start, j), index: start, end: j + 1 };
    if (quote === '"' && text[j] === "\n") return null;
  }
  return null;
}

/**
 * Adjacent literals joined the way the language joins them: Python implicit
 * concatenation (optionally inside parentheses), Go `+`.
 */
function stringExpression(text: string, i: number, language: "python" | "go"): TextSpan | null {
  const read = language === "python" ? pyStringAt : goStringAt;
  let j = i;
  const skip = () => {
    for (;;) {
      const ws = /^\s*/.exec(text.slice(j, j + 200))![0].length;
      j += ws;
      if (language === "python" && text[j] === "#") {
        const nl = text.indexOf("\n", j);
        j = nl < 0 ? text.length : nl;
        continue;
      }
      return;
    }
  };
  skip();
  while (language === "python" && text[j] === "(") {
    j++;
    skip();
  }
  const first = read(text, j);
  if (!first) return null;
  let value = first.value;
  j = first.end;
  for (;;) {
    const save = j;
    skip();
    if (language === "go") {
      if (text[j] !== "+") {
        j = save;
        break;
      }
      j++;
      skip();
    }
    const next = read(text, j);
    if (!next) {
      j = save;
      break;
    }
    value += next.value;
    j = next.end;
  }
  return { text: value, index: first.index };
}

/**
 * The offset just past the bracket that closes the one at `open`, skipping
 * string literals and comments of the language; bounded.
 */
export function closingBracket(text: string, open: number, language: "python" | "go"): number {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: string[] = [];
  const limit = Math.min(text.length, open + MAX_SPAN * 4);
  for (let i = open; i < limit; i++) {
    const c = text[i]!;
    if (language === "python" && c === "#") {
      const nl = text.indexOf("\n", i);
      i = nl < 0 ? limit : nl;
      continue;
    }
    if (language === "go" && c === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i);
      i = nl < 0 ? limit : nl;
      continue;
    }
    if (language === "go" && c === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      i = close < 0 ? limit : close + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const s = language === "python" ? pyStringAt(text, i) : c === "'" ? runeEnd(text, i) : goStringAt(text, i);
      if (s) {
        i = s.end - 1;
        continue;
      }
    }
    if (pairs[c]) stack.push(pairs[c]!);
    else if (c === ")" || c === "]" || c === "}") {
      if (stack.pop() !== c) return i + 1;
      if (stack.length === 0) return i + 1;
    }
  }
  return limit;
}

/** A Go rune literal ('x', '\n'). */
function runeEnd(text: string, i: number): { end: number } | null {
  const m = /^'(?:\\.[^']*|[^'\\])'/.exec(text.slice(i, i + 12));
  return m ? { end: i + m[0].length } : null;
}

/** Keyword argument / struct field value: the string after `key=` (Python) or `Key:` (Go) inside [from, to). */
function stringField(text: string, from: number, to: number, key: RegExp, language: "python" | "go", options: { topLevel?: boolean } = {}): TextSpan | null {
  const re = new RegExp(key.source, "g");
  const top = options.topLevel ? topLevelRanges(text, from, to, language) : null;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && m.index < to) {
    if (top && !top.some(([a, b]) => m!.index >= a && m!.index < b)) continue;
    const value = stringValue(text, m.index + m[0].length, language);
    if (value && value.index < to) return value;
  }
  return null;
}

/**
 * A string, or a string passed through a helper as its last literal
 * argument: `t("TOOL_X_DESCRIPTION", "Get …")` (translation helpers),
 * `_("…")`.
 */
function stringValue(text: string, i: number, language: "python" | "go"): TextSpan | null {
  const direct = stringExpression(text, i, language);
  if (direct) return direct;
  const call = /^\s*[A-Za-z_][\w.]*\(/.exec(text.slice(i, i + 120));
  if (!call) return null;
  const open = i + call[0].length - 1;
  let last: TextSpan | null = null;
  for (const start of argumentStarts(text, open, closingBracket(text, open, language), language)) {
    last = stringExpression(text, start, language) ?? last;
  }
  return last;
}

/** Offsets where each top-level argument of the call whose `(` is at `open` begins. */
function argumentStarts(text: string, open: number, close: number, language: "python" | "go"): number[] {
  const starts = [open + 1];
  let i = open + 1;
  while (i < close - 1) {
    const c = text[i]!;
    if (c === "(" || c === "[" || c === "{") {
      i = closingBracket(text, i, language);
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const str = language === "python" ? pyStringAt(text, i) : c === "'" ? runeEnd(text, i) : goStringAt(text, i);
      if (str) {
        i = str.end;
        continue;
      }
    }
    if (c === ",") starts.push(i + 1);
    i++;
  }
  return starts;
}

/** [start, end) ranges directly inside the bracket at `open` (nested brackets excluded). */
function topLevelRanges(text: string, open: number, close: number, language: "python" | "go"): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let start = open + 1;
  let i = open + 1;
  while (i < close - 1) {
    const c = text[i]!;
    if (c === "(" || c === "[" || c === "{") {
      ranges.push([start, i]);
      i = closingBracket(text, i, language);
      start = i;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const s = language === "python" ? pyStringAt(text, i) : c === "'" ? runeEnd(text, i) : goStringAt(text, i);
      if (s) {
        i = s.end;
        continue;
      }
    }
    i++;
  }
  ranges.push([start, close]);
  return ranges;
}

/** Every string matched by `re` (group 1 = the opening position marker) inside [from, to). */
function stringsAfter(text: string, from: number, to: number, re: RegExp, language: "python" | "go"): TextSpan[] {
  const out: TextSpan[] = [];
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  const slice = text.slice(from, to);
  let m: RegExpExecArray | null;
  while ((m = g.exec(slice)) !== null) {
    const value = stringExpression(text, from + m.index + m[0].length, language);
    if (value && value.index < to) out.push(value);
    if (m.index === g.lastIndex) g.lastIndex++;
  }
  return out;
}

// ── Python ──────────────────────────────────────────────────────────────────

/**
 * End of the indented block whose header starts on the line containing `at`
 * and ends at `headerEnd` (past a multi-line signature or condition).
 */
function pythonBlockEnd(text: string, at: number, headerEnd: number = at): number {
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  const indent = /^[ \t]*/.exec(text.slice(lineStart))![0].length;
  let i = text.indexOf("\n", headerEnd);
  const limit = Math.min(text.length, at + MAX_SPAN);
  while (i >= 0 && i < limit) {
    const next = text.indexOf("\n", i + 1);
    const line = text.slice(i + 1, next < 0 ? text.length : next);
    if (line.trim() && !line.trimStart().startsWith("#")) {
      const lineIndent = /^[ \t]*/.exec(line)![0].length;
      if (lineIndent <= indent) return i + 1;
    }
    if (next < 0) return text.length;
    i = next;
  }
  return limit;
}

/** A `def name(` in the file: [start, end) of the function. */
function pythonFunction(text: string, name: string): [number, number] | null {
  const fn = new RegExp(`(?:^|\\n)[ \\t]*(?:async[ \\t]+)?def[ \\t]+${escapeRe(name)}[ \\t]*\\(`).exec(text);
  if (!fn) return null;
  const open = fn.index + fn[0].length - 1;
  return [fn.index + fn[0].indexOf("def"), pythonBlockEnd(text, fn.index + fn[0].indexOf("def"), closingBracket(text, open, "python"))];
}

/** Top-level comma-separated parameter names of a Python signature. */
function pythonParams(signature: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let current = "";
  for (const c of signature) {
    if ("([{".includes(c)) depth++;
    if (")]}".includes(c)) depth--;
    if (c === "," && depth === 0) {
      names.push(current);
      current = "";
    } else current += c;
  }
  names.push(current);
  return names
    .map((p) => /^\s*\*{0,2}([A-Za-z_]\w*)\s*(?::\s*([^=]+))?/.exec(p))
    .filter((m): m is RegExpExecArray => !!m)
    .filter((m) => !["self", "cls"].includes(m[1]!) && !/\bContext\b/.test(m[2] ?? ""))
    .map((m) => m[1]!);
}

const PY_READ_ONLY = /readOnlyHint["']?\s*[:=]\s*True\b/;

/** `@<obj>.tool` decorated functions (FastMCP, official SDK's FastMCP, server.tool). */
function pythonDecoratedTools(text: string): SourceTool[] {
  const tools: SourceTool[] = [];
  const re = /^[ \t]*@[\w.]*?\btool\b[ \t]*(\()?/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const index = m.index + m[0].indexOf("@");
    const decoratorEnd = m[1] ? closingBracket(text, m.index + m[0].length - 1, "python") : m.index + m[0].length;
    const def = /(?:^|\n)[ \t]*(?:async[ \t]+)?def[ \t]+(\w+)[ \t]*\(/.exec(text.slice(decoratorEnd, decoratorEnd + 2000));
    if (!def) continue;
    const defAt = decoratorEnd + def.index + def[0].indexOf("def");
    const parenOpen = decoratorEnd + def.index + def[0].length - 1;
    const parenClose = closingBracket(text, parenOpen, "python");
    const signature = text.slice(parenOpen + 1, parenClose - 1);
    const end = pythonBlockEnd(text, defAt, parenClose);
    const decorator = m[1] ? text.slice(m.index + m[0].length, decoratorEnd - 1) : "";
    const decoratorAt = m.index + m[0].length;

    const explicitName = m[1]
      ? stringField(text, decoratorAt, decoratorEnd, /\bname\s*=\s*/, "python") ?? (/^\s*[rRuU]?["']/.test(decorator) ? stringExpression(text, decoratorAt, "python") : null)
      : null;
    const fromDecorator = m[1] ? stringField(text, decoratorAt, decoratorEnd, /\bdescription\s*=\s*/, "python") : null;
    let description = fromDecorator;
    if (!description) {
      // The docstring: first statement after the signature's closing `:`
      const colon = /^\s*(?:->[^:]+)?:\s*/.exec(text.slice(parenClose, parenClose + 400));
      const doc = colon ? pyStringAt(text, parenClose + colon[0].length) : null;
      if (doc) description = { text: doc.value, index: doc.index };
    }
    tools.push({
      name: explicitName?.text ?? def[1]!,
      index,
      description,
      schemaStrings: stringsAfter(text, parenOpen, parenClose, /\bdescription\s*=\s*/, "python").concat(
        stringsAfter(text, parenOpen, parenClose, /\bAnnotated\[[^,\]]+,\s*(?=[rRuU]?["'])/, "python"),
      ),
      readOnlyHint: PY_READ_ONLY.test(decorator),
      inputs: pythonParams(signature),
      handler: [[parenClose, end]],
    });
    re.lastIndex = Math.max(re.lastIndex, decoratorEnd);
  }
  return tools;
}

/**
 * Low-level server: `types.Tool(name=..., description=..., inputSchema=...)`
 * in the list_tools handler; the code that runs is the `name == "..."`
 * branch of the call_tool handler (or a function it dispatches to).
 */
function pythonLowLevelTools(text: string): SourceTool[] {
  const tools: SourceTool[] = [];
  const re = /(?<![\w.])(?:types\.|mcp\.types\.)?Tool\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = closingBracket(text, open, "python");
    const name = stringField(text, open, close, /\bname\s*=\s*/, "python");
    if (!name) continue;
    const description = stringField(text, open, close, /\bdescription\s*=\s*/, "python");
    const schemaStrings = stringsAfter(text, open, close, /["']description["']\s*:\s*/, "python");
    const handler: Array<[number, number]> = [];
    const branch = new RegExp(`\\bname\\s*==\\s*["']${escapeRe(name.text)}["']\\s*:`, "g");
    let b: RegExpExecArray | null;
    while ((b = branch.exec(text)) !== null) {
      const branchEnd = pythonBlockEnd(text, b.index, b.index + b[0].length);
      handler.push([b.index, branchEnd]);
      // A branch that just dispatches: `return await handle_x(arguments)` → that function too
      const call = /\breturn\s+(?:await\s+)?([A-Za-z_]\w*)\s*\(/.exec(text.slice(b.index, branchEnd));
      const fn = call ? pythonFunction(text, call[1]!) : null;
      if (fn) handler.push(fn);
    }
    tools.push({
      name: name.text,
      index: m.index,
      description,
      schemaStrings,
      readOnlyHint: PY_READ_ONLY.test(text.slice(open, close)),
      inputs: ["arguments", "args", "params"],
      handler,
    });
    re.lastIndex = close;
  }
  return tools;
}

export function extractPythonTools(text: string): SourceTool[] {
  return [...pythonDecoratedTools(text), ...pythonLowLevelTools(text)].sort((a, b) => a.index - b.index);
}

// ── Go ──────────────────────────────────────────────────────────────────────

const GO_READ_ONLY = /ReadOnlyHint\s*:\s*(?:mcp\.ToBoolPtr\(\s*|ptr\(\s*|&?)?true\b|WithReadOnlyHintAnnotation\(\s*true\s*\)/;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The body of `func name(` (or method) declared in the file: from the declaration to the next top-level func. */
function goFunction(text: string, name: string): { span: [number, number]; signature: string } | null {
  const re = new RegExp(`(?:^|\\n)func\\s+(?:\\([^)]*\\)\\s*)?${escapeRe(name)}\\s*(?:\\[[^\\]]*\\])?\\s*\\(`);
  const m = re.exec(text);
  if (!m) return null;
  const start = m.index + (text[m.index] === "\n" ? 1 : 0);
  const next = text.indexOf("\nfunc ", start + 1);
  const end = Math.min(next < 0 ? text.length : next + 1, start + MAX_SPAN * 2);
  const brace = text.indexOf("{", m.index + m[0].length);
  return { span: [start, end], signature: text.slice(start, brace < 0 ? end : brace) };
}

/** The handler argument that follows a tool in an AddTool call: an inline func literal or a function name. */
function goHandler(text: string, after: number): { span: [number, number]; signature: string } | null {
  const rest = text.slice(after, after + 400);
  const inline = /^\s*,\s*(?:mcp\.NewTypedToolHandler\(\s*)?func\s*\(/.exec(rest);
  if (inline) {
    const start = after + inline.index + inline[0].lastIndexOf("func");
    const brace = text.indexOf("{", start);
    if (brace < 0) return null;
    // the func's own signature can contain (…) but its body starts at the first `{` after the result list
    const end = closingBracket(text, brace, "go");
    return { span: [start, end], signature: text.slice(start, brace) };
  }
  const named = /^\s*,\s*(?:mcp\.NewTypedToolHandler\(\s*)?(?:[\w]+\.)*([A-Za-z_]\w*)\s*\)?\s*\)/.exec(rest);
  return named ? goFunction(text, named[1]!) : null;
}

/** Input names inside a Go handler: the typed-args parameter (official SDK) and variables read from the request (mark3labs). */
function goInputs(text: string, handler: [number, number] | null, signature: string): string[] {
  const inputs = new Set<string>();
  // func(ctx context.Context, req *mcp.CallToolRequest, args Input) — the typed input is the 3rd parameter
  const params = /\(([^)]*)\)/.exec(signature)?.[1] ?? "";
  const parts = params.split(",").map((p) => p.trim().split(/\s+/));
  if (parts.length >= 3 && parts[2]![0]) inputs.add(parts[2]![0]);
  const request = parts.find((p) => /CallToolRequest/.test(p.join(" ")))?.[0];
  if (request) inputs.add(`${request}.Params.Arguments`);
  if (handler) {
    const body = text.slice(handler[0], handler[1]);
    // cmd, err := request.RequireString("cmd") / request.GetString("cmd", "") / args["cmd"].(string)
    const reads = /\b([A-Za-z_]\w*)\s*(?:,\s*\w+\s*)?:?=\s*(?:[\w.]+\.(?:Require|Get)(?:String|Int|Float|Bool|StringSlice|Arguments)\w*\s*\(|[\w.]*Arguments\s*\[|args\s*\[)/g;
    let m: RegExpExecArray | null;
    while ((m = reads.exec(body)) !== null) inputs.add(m[1]!);
  }
  return [...inputs];
}

/** `type Input struct { X string `jsonschema:"…"` }` — the descriptions the model sees for a typed input. */
function goStructTags(text: string, signature: string): TextSpan[] {
  const params = /\(([^)]*)\)/.exec(signature)?.[1] ?? "";
  const type = params.split(",")[2]?.trim().split(/\s+/)[1]?.replace(/^\*/, "");
  if (!type) return [];
  const decl = new RegExp(`\\btype\\s+${escapeRe(type)}\\s+struct\\s*\\{`).exec(text);
  if (!decl) return [];
  const open = decl.index + decl[0].length - 1;
  const close = closingBracket(text, open, "go");
  const out: TextSpan[] = [];
  const re = /jsonschema:"((?:\\.|[^"\\])*)"/g;
  const body = text.slice(open, close);
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.push({ text: m[1]!, index: open + m.index + "jsonschema:\"".length });
  return out;
}

/** Official Go SDK: `&mcp.Tool{Name: …, Description: …}` (any import alias) passed to mcp.AddTool / server.AddTool. */
function goOfficialTools(text: string): SourceTool[] {
  const tools: SourceTool[] = [];
  const re = /&?\b[a-z]\w*\.Tool\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = closingBracket(text, open, "go");
    const name = stringField(text, open, close, /\bName\s*:\s*/, "go", { topLevel: true });
    if (!name) continue;
    const description = stringField(text, open, close, /\bDescription\s*:\s*/, "go", { topLevel: true });
    // A struct bound to a variable first: `tool := &mcp.Tool{...}` … `mcp.AddTool(s, tool, h)`
    const variable = /([A-Za-z_]\w*)\s*:?=\s*$/.exec(text.slice(Math.max(0, m.index - 80), m.index))?.[1];
    let handler = goHandler(text, close);
    if (!handler && variable) {
      const add = new RegExp(`AddTool\\s*\\(\\s*(?:[\\w.]+\\s*,\\s*)?${escapeRe(variable)}\\b`).exec(text.slice(close));
      if (add) handler = goHandler(text, close + add.index + add[0].length);
    }
    const signature = handler?.signature ?? "";
    tools.push({
      name: name.text,
      index: m.index,
      description,
      schemaStrings: [
        // Property descriptions: map literals ("description": …) and jsonschema.Schema structs nested in InputSchema
        ...stringsAfter(text, open, close, /["']description["']\s*:\s*/, "go"),
        ...stringsAfter(text, open, close, /\bDescription\s*:\s*/, "go").filter((s) => s.index !== description?.index),
        ...goStructTags(text, signature),
      ],
      readOnlyHint: GO_READ_ONLY.test(text.slice(open, close)),
      inputs: goInputs(text, handler?.span ?? null, signature),
      handler: handler ? [handler.span] : [],
    });
    re.lastIndex = close;
  }
  return tools;
}

/** mark3labs/mcp-go: `mcp.NewTool("name", mcp.WithDescription("…"), mcp.WithString("p", mcp.Description("…")))`. */
function goMark3labsTools(text: string): SourceTool[] {
  const tools: SourceTool[] = [];
  const re = /\bmcp\.NewTool\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = closingBracket(text, open, "go");
    const name = stringExpression(text, open + 1, "go");
    if (!name) continue;
    const description = stringField(text, open, close, /\bWithDescription\s*\(\s*/, "go");
    const variable = /([A-Za-z_]\w*)\s*:?=\s*$/.exec(text.slice(Math.max(0, m.index - 80), m.index))?.[1];
    let handler = goHandler(text, close);
    if (!handler && variable) {
      const add = new RegExp(`\\.AddTools?\\s*\\(\\s*(?:server\\.ServerTool\\{\\s*Tool:\\s*)?${escapeRe(variable)}\\b`).exec(text.slice(close));
      if (add) {
        const after = close + add.index + add[0].length;
        handler = goHandler(text, after) ?? goHandler(text, after + (/^\s*,\s*Handler:\s*/.exec(text.slice(after))?.[0].length ?? 0) - 1);
      }
    }
    tools.push({
      name: name.text,
      index: m.index,
      description,
      schemaStrings: stringsAfter(text, open, close, /\b(?:mcp\.)?Description\s*\(\s*/, "go"),
      readOnlyHint: GO_READ_ONLY.test(text.slice(open, close)),
      inputs: goInputs(text, handler?.span ?? null, handler?.signature ?? ""),
      handler: handler ? [handler.span] : [],
    });
    re.lastIndex = close;
  }
  return tools;
}

export function extractGoTools(text: string): SourceTool[] {
  return [...goOfficialTools(text), ...goMark3labsTools(text)].sort((a, b) => a.index - b.index);
}

/** Tool definitions of a Python or Go source file; [] for other languages. */
export function extractSourceTools(text: string, language: SourceLanguage | undefined): SourceTool[] {
  if (language === "python") return extractPythonTools(text);
  if (language === "go") return extractGoTools(text);
  return [];
}

/**
 * The text of a call starting at `index` (the callee) through its closing
 * parenthesis, for checking which values flow into it.
 */
export function callSpan(text: string, index: number, language: "python" | "go"): string {
  const open = text.indexOf("(", index);
  if (open < 0) return "";
  return text.slice(index, closingBracket(text, open, language));
}

/** True when one of `inputs` (a name or dotted prefix) appears in `code` as a whole word. */
export function mentionsInput(code: string, inputs: string[]): string | undefined {
  return inputs.find((name) => new RegExp(`(?<![\\w.])${escapeRe(name)}(?!\\w)`).test(code));
}
