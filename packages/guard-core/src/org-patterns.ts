import { Script, createContext, type Context } from "node:vm";
import { z } from "zod";
import { PII_PATTERNS } from "./pii.js";

/**
 * An organization's own patterns next to the built-in detectors:
 * `blockPatterns` mask what no detector knows (a case number, a client code),
 * `allowPatterns` leave a detected value alone (the company's public support
 * address). A request can add block patterns, never allow patterns, so it can
 * only ever increase masking.
 */
export interface OrgPatternConfig {
  blockPatterns?: readonly (string | { pattern: string; category: string })[];
  allowPatterns?: readonly string[];
}

export const ORG_PATTERN_LIMITS = { patterns: 25, length: 200 } as const;
/** Time one pattern may take over one masking call's text, in ms. */
export const DEFAULT_PATTERN_BUDGET_MS = 100;
const DEFAULT_CATEGORY = "CUSTOM";
const LABEL = /^[A-Z][A-Z0-9_]{0,31}$/;

export type OrgPatternEvent =
  /** An allow pattern kept a detected value unmasked. */
  | { type: "allowed"; pattern: string; detector: string }
  /** An allow pattern ran over its budget and was skipped: the value stays masked. */
  | { type: "allow_skipped"; pattern: string };

/** A block pattern ran over its budget. Nothing may go out unmasked: the caller refuses. */
export class PiiPatternTimeoutError extends Error {
  constructor(readonly pattern: string, readonly budgetMs: number) {
    super(`block pattern ${JSON.stringify(pattern)} took longer than ${budgetMs} ms; refusing rather than leaving its matches unmasked`);
    this.name = "PiiPatternTimeoutError";
  }
}

/** Built-in detector names (and "secret", the proxy's credential bucket) a label may not take. */
function reservedLabels(): Set<string> {
  return new Set(["SECRET", ...PII_PATTERNS.map((p) => p.name.toUpperCase())]);
}

const blockEntry = (entry: string | { pattern: string; category: string }) =>
  typeof entry === "string" ? { pattern: entry, category: DEFAULT_CATEGORY } : entry;

/** Problems with a set of org patterns, each with its path; empty when it is valid. */
export function orgPatternIssues(config: OrgPatternConfig): { path: (string | number)[]; message: string }[] {
  const issues: { path: (string | number)[]; message: string }[] = [];
  const block = config.blockPatterns ?? [];
  const allow = config.allowPatterns ?? [];
  if (block.length + allow.length > ORG_PATTERN_LIMITS.patterns) {
    issues.push({ path: [], message: `at most ${ORG_PATTERN_LIMITS.patterns} block and allow patterns together (got ${block.length + allow.length})` });
  }
  const reserved = reservedLabels();
  const check = (pattern: string, path: (string | number)[]) => {
    if (pattern.length > ORG_PATTERN_LIMITS.length) issues.push({ path, message: `a pattern is at most ${ORG_PATTERN_LIMITS.length} characters` });
    try {
      new RegExp(pattern, "g");
    } catch (err) {
      issues.push({ path, message: `invalid regular expression: ${(err as Error).message}` });
    }
  };
  block.forEach((entry, index) => {
    const { pattern, category } = blockEntry(entry);
    const path = typeof entry === "string" ? ["blockPatterns", index] : ["blockPatterns", index, "pattern"];
    check(pattern, path);
    if (typeof entry !== "string") {
      if (!LABEL.test(category)) {
        issues.push({ path: ["blockPatterns", index, "category"], message: "a category is upper case letters, digits and _ (e.g. CLIENT_NO), at most 32" });
      } else if (reserved.has(category)) {
        issues.push({ path: ["blockPatterns", index, "category"], message: `category "${category}" is a built-in detector name` });
      }
    }
  });
  allow.forEach((pattern, index) => check(pattern, ["allowPatterns", index]));
  return issues;
}

/** The two fields, for config objects that hold them next to other settings. */
export const orgPatternShape = {
  blockPatterns: z
    .array(z.union([z.string().min(1), z.object({ pattern: z.string().min(1), category: z.string().min(1) }).strict()]))
    .optional(),
  allowPatterns: z.array(z.string().min(1)).optional(),
};

/** Report every problem with the org patterns in `value` at its path. */
export function checkOrgPatterns(value: OrgPatternConfig, ctx: z.RefinementCtx, path: (string | number)[] = []): void {
  for (const issue of orgPatternIssues(value)) ctx.addIssue({ code: "custom", path: [...path, ...issue.path], message: issue.message });
}

interface Compiled {
  source: string;
  re: RegExp;
  category: string;
}

export interface OrgPatternOptions {
  /** Per pattern, per masking call (default 100 ms). */
  budgetMs?: number;
  onEvent?: (event: OrgPatternEvent) => void;
}

/** A block match in one text: [start, end) and the category it masks as. */
export interface BlockMatch {
  start: number;
  end: number;
  category: string;
}

const MATCH_ALL = new Script(
  "out = texts.map(function (t) { re.lastIndex = 0; var r = []; for (var m of t.matchAll(re)) if (m[0].length) r.push(m.index, m[0].length); return r; });",
);
const TEST_ALL = new Script("out = texts.map(function (t) { return re.test(t); });");

/**
 * Validated, compiled org patterns. Each pattern runs in a `vm` context with
 * a time budget, so a catastrophic regex cannot hang the process: a block
 * pattern over budget throws `PiiPatternTimeoutError` (fail closed), an allow
 * pattern over budget is skipped (no exemption under uncertainty).
 */
export class OrgPatterns {
  private readonly block: Compiled[];
  private readonly allow: Compiled[];
  private readonly budgetMs: number;
  private onEvent: ((event: OrgPatternEvent) => void) | undefined;
  private context: Context | undefined;
  private categorySet: ReadonlySet<string> | undefined;

  private constructor(
    private readonly config: OrgPatternConfig,
    options: OrgPatternOptions,
  ) {
    const issues = orgPatternIssues(config);
    if (issues.length > 0) throw new Error(issues.map((i) => `${i.path.join(".") || "patterns"}: ${i.message}`).join("; "));
    this.block = (config.blockPatterns ?? []).map(blockEntry).map(({ pattern, category }) => ({ source: pattern, re: new RegExp(pattern, "g"), category }));
    this.allow = (config.allowPatterns ?? []).map((pattern) => ({ source: pattern, re: new RegExp(`^(?:${pattern})$`), category: "" }));
    this.budgetMs = options.budgetMs ?? DEFAULT_PATTERN_BUDGET_MS;
    this.onEvent = options.onEvent;
  }

  /** Throws on an invalid pattern, a limit or a reserved category. */
  static compile(config: OrgPatternConfig = {}, options: OrgPatternOptions = {}): OrgPatterns {
    return new OrgPatterns(config, options);
  }

  /**
   * These patterns plus a request's own block patterns. A request cannot drop
   * a configured pattern, and cannot bring allow patterns: that would weaken masking.
   */
  withRequest(request: OrgPatternConfig): OrgPatterns {
    if ((request.allowPatterns ?? []).length > 0) throw new Error("allowPatterns cannot come from a request: a request may only add masking");
    if ((request.blockPatterns ?? []).length === 0) return this;
    return new OrgPatterns(
      { ...this.config, blockPatterns: [...(this.config.blockPatterns ?? []), ...(request.blockPatterns ?? [])] },
      { budgetMs: this.budgetMs, ...(this.onEvent ? { onEvent: this.onEvent } : {}) },
    );
  }

  /**
   * Run `fn` with `onEvent` as this call's event listener. Masking is
   * synchronous, so one compiled set can serve every session and still
   * report each event with that call's context.
   */
  withEvents<T>(onEvent: (event: OrgPatternEvent) => void, fn: () => T): T {
    const previous = this.onEvent;
    this.onEvent = onEvent;
    try {
      return fn();
    } finally {
      this.onEvent = previous;
    }
  }

  get empty(): boolean {
    return this.block.length === 0 && this.allow.length === 0;
  }

  get hasAllow(): boolean {
    return this.allow.length > 0;
  }

  get hasBlock(): boolean {
    return this.block.length > 0;
  }

  /** Categories the block patterns mask as. */
  get categories(): ReadonlySet<string> {
    return (this.categorySet ??= new Set(this.block.map((b) => b.category)));
  }

  /** Detected values that some allow pattern matches in full, with that pattern. */
  allowed(values: readonly string[]): Map<string, string> {
    const exempt = new Map<string, string>();
    if (values.length === 0) return exempt;
    for (const pattern of this.allow) {
      const result = this.run(TEST_ALL, pattern.re, values) as boolean[] | null;
      if (result === null) {
        this.onEvent?.({ type: "allow_skipped", pattern: pattern.source });
        continue;
      }
      result.forEach((hit, i) => hit && !exempt.has(values[i]!) && exempt.set(values[i]!, pattern.source));
    }
    return exempt;
  }

  /** Report that an allow pattern kept a detected value unmasked. */
  noteAllowed(pattern: string, detector: string): void {
    this.onEvent?.({ type: "allowed", pattern, detector });
  }

  /** Block matches per text, earlier patterns first, never overlapping. */
  blockMatches(texts: readonly string[]): BlockMatch[][] {
    const out: BlockMatch[][] = texts.map(() => []);
    if (texts.length === 0) return out;
    for (const pattern of this.block) {
      const result = this.run(MATCH_ALL, pattern.re, texts) as number[][] | null;
      if (result === null) throw new PiiPatternTimeoutError(pattern.source, this.budgetMs);
      result.forEach((pairs, i) => {
        const taken = out[i]!;
        for (let k = 0; k < pairs.length; k += 2) {
          const start = pairs[k]!;
          const end = start + pairs[k + 1]!;
          if (!taken.some((m) => start < m.end && m.start < end)) taken.push({ start, end, category: pattern.category });
        }
      });
    }
    for (const matches of out) matches.sort((a, b) => a.start - b.start);
    return out;
  }

  /** Run one pattern over the texts within the budget; null when it ran over. */
  private run(script: Script, re: RegExp, texts: readonly string[]): unknown[] | null {
    this.context ??= createContext({ re: null, texts: null, out: null });
    this.context["re"] = re;
    this.context["texts"] = texts;
    try {
      script.runInContext(this.context, { timeout: this.budgetMs });
      return this.context["out"] as unknown[];
    } catch (err) {
      if ((err as { code?: string }).code === "ERR_SCRIPT_EXECUTION_TIMEOUT") return null;
      throw err;
    } finally {
      this.context["texts"] = null;
      this.context["out"] = null;
    }
  }
}
