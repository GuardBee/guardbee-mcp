import type {
  CallToolResult,
  GetPromptResult,
  Prompt,
  ReadResourceResult,
  Resource,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { maskPiiInValue, PII_PATTERNS, scanForPromptInjection, scanToolResult } from "@guardbee/guard-core";
import { recordEvent } from "@guardbee/mcp-telemetry";
import type { AuditLogger } from "../audit/logger.js";
import { ToolDefinitionPin, type ToolRecord } from "../interceptors/definition-drift.js";
import type { AuditEvent } from "../types.js";
import type { Approver } from "./approval.js";
import type { GatewayConfig } from "./config.js";
import { maskFields } from "./fields.js";
import { labelTool, type Label } from "./labels.js";
import { DataFingerprints } from "./fingerprints.js";
import { evaluatePolicy } from "./policy.js";
import { TaintTracker } from "./taint.js";
import { PiiVault } from "./tokens.js";
import type { Upstream } from "./upstream.js";

const SEPARATOR = "__";

/** Pattern names that are personal data; every other PII pattern is a credential and counts as "secret". */
const PERSONAL_DATA = new Set(["tc_kimlik", "vkn", "iban", "credit_card", "email", "phone_tr"]);
const PLACEHOLDER = new Map(PII_PATTERNS.map((p) => [p.name, p.replacement]));

type PiiHits = Record<string, number>;

function addHits(into: PiiHits, from: PiiHits): PiiHits {
  for (const [category, count] of Object.entries(from)) into[category] = (into[category] ?? 0) + count;
  return into;
}
const PREFIX = "[GuardBee Security Proxy]";

interface ToolRoute {
  upstream: Upstream;
  /** The tool's name on its own server. */
  name: string;
  labels: Label[];
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text: `${PREFIX} ${text}` }], isError: true };
}

/**
 * The policy pipeline between the agent and its MCP servers. Transport-free:
 * proxy.ts wires it to stdio, tests drive it directly.
 *
 * A tool call runs: input injection scan → definition drift → policy rules
 * (incl. approval) → toxic-flow check → detokenize → upstream → result
 * injection scan → PII masking / tokenizing → field masking → taint update.
 */
export class Gateway {
  readonly taint = new TaintTracker();
  readonly vault = new PiiVault();
  /** Hashes of the sensitive data this session's tools returned, for the data-based taint check. */
  readonly fingerprints = new DataFingerprints();
  private readonly pins = new Map<string, ToolDefinitionPin>();
  private readonly tools = new Map<string, ToolRoute>();
  private readonly resources = new Map<string, Upstream>();
  private readonly prompts = new Map<string, { upstream: Upstream; name: string }>();
  /** Upstreams that announced tools/list_changed since the agent last listed tools. */
  private readonly stale = new Set<string>();
  private readonly toolListeners: (() => void)[] = [];
  private readonly unsubscribers: (() => void)[] = [];
  private readonly sessionId?: string;

  /**
   * One Gateway per agent session: taint, PII tokens and pins are per session.
   * Over HTTP several sessions share the same upstream connections.
   */
  constructor(
    private readonly upstreams: readonly Upstream[],
    private readonly config: GatewayConfig,
    private readonly audit: AuditLogger,
    private readonly approver?: Approver,
    options: { sessionId?: string } = {},
  ) {
    this.sessionId = options.sessionId;
    for (const upstream of upstreams) {
      const unsubscribe = upstream.onToolsChanged?.(() => {
        this.stale.add(upstream.name);
        for (const listener of this.toolListeners) listener();
      });
      if (unsubscribe) this.unsubscribers.push(unsubscribe);
    }
  }

  /** Called when any upstream's tool list changed; proxy.ts relays it to the agent. */
  onToolsChanged(listener: () => void): void {
    this.toolListeners.push(listener);
  }

  private get interceptors() {
    return this.config.interceptors;
  }

  private exposed(upstream: Upstream, name: string): string {
    return this.config.namespaced ? `${upstream.name}${SEPARATOR}${name}` : name;
  }

  private pinFor(upstream: Upstream): ToolDefinitionPin {
    let pin = this.pins.get(upstream.name);
    if (!pin) this.pins.set(upstream.name, (pin = new ToolDefinitionPin()));
    return pin;
  }

  private log(event: Omit<AuditEvent, "ts" | "taint">): void {
    this.audit.log({
      ts: new Date().toISOString(),
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      ...event,
      taint: this.taint.snapshot(),
    });
  }

  private get driftEnabled(): boolean {
    return this.interceptors.definitionDrift?.enabled !== false;
  }

  private get driftAction(): "block" | "warn" {
    return this.interceptors.definitionDrift?.action ?? this.interceptors.promptInjection?.action ?? "block";
  }

  private get resultAction(): "block" | "warn" {
    return this.interceptors.toolResultInjection?.action ?? this.interceptors.promptInjection?.action ?? "block";
  }

  /**
   * Find PII in a value (it taints the session either way) and hide it unless
   * masking is off. `force` comes from a `mask` rule and overrides "off".
   */
  private protect<T>(value: T, force = false): { value: T; piiFound: boolean; hits: PiiHits } {
    const hits: PiiHits = {};
    const redacted = maskPiiInValue(value, (name) => {
      const category = PERSONAL_DATA.has(name) ? name : "secret";
      hits[category] = (hits[category] ?? 0) + 1;
      return PLACEHOLDER.get(name) ?? "[REDACTED]";
    }) as T;
    const piiFound = Object.keys(hits).length > 0;
    const enabled = this.interceptors.piiMasking?.enabled !== false || force;
    if (!piiFound || !enabled) return { value, piiFound, hits };
    const tokenize = this.interceptors.piiMasking?.mode === "tokenize";
    return { value: tokenize ? this.vault.tokenize(value) : redacted, piiFound, hits };
  }

  async listTools(): Promise<Tool[]> {
    const listed: Tool[] = [];
    for (const upstream of this.upstreams) {
      let tools: Tool[];
      try {
        tools = await upstream.listTools();
      } catch (err) {
        // One broken server must not take the others' tools away.
        this.log({ type: "warn", upstream: upstream.name, reason: `tools/list failed: ${err instanceof Error ? err.message : String(err)}` });
        continue;
      }
      this.stale.delete(upstream.name);
      if (this.driftEnabled) {
        const observed = this.pinFor(upstream).observe(tools as ToolRecord[], this.driftAction);
        for (const finding of observed.findings) {
          this.log({
            type: this.driftAction === "block" ? "blocked" : "warn",
            tool: this.exposed(upstream, finding.toolName),
            server: upstream.name,
            upstream: upstream.name,
            reason: finding.reason,
          });
        }
        tools = observed.tools as Tool[];
      }
      for (const tool of tools) {
        const name = this.exposed(upstream, tool.name);
        const labels = this.config.labels[name] ?? labelTool(tool);
        this.tools.set(name, { upstream, name: tool.name, labels });
        listed.push({ ...tool, name });
      }
    }
    return listed;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const started = Date.now();
    let route = this.tools.get(name);
    if (!route) {
      await this.listTools();
      route = this.tools.get(name);
    }
    if (!route) return errorResult(`Unknown tool: ${name}`);

    const { upstream, labels } = route;
    const base = { tool: name, server: upstream.name, upstream: upstream.name, labels };
    const block = (reason: string, extra: Partial<AuditEvent> = {}): CallToolResult => {
      this.log({ ...base, type: "blocked", input: args, reason, ...extra });
      void recordEvent({
        server: "security-proxy",
        tool: name,
        params: args,
        success: false,
        durationMs: Date.now() - started,
        error: `blocked: ${reason}`,
      });
      return errorResult(`Tool call blocked: ${reason}`);
    };
    /** null = approved, go on; otherwise the result to return. */
    const askApproval = async (reason: string, extra: Partial<AuditEvent> = {}): Promise<CallToolResult | null> => {
      const outcome = this.approver
        ? await this.approver({ tool: name, upstream: upstream.name, args, reason, ...(this.sessionId ? { sessionId: this.sessionId } : {}) })
        : "unavailable";
      this.log({ ...base, type: "approval", input: args, reason: `${outcome}: ${reason}`, ...extra });
      if (outcome === "approved") return null;
      if (outcome === "unavailable") {
        return errorResult(
          `Tool call blocked: it needs a person's approval, but this client cannot show an approval prompt (MCP elicitation). ${reason}`,
        );
      }
      return errorResult(`Tool call not approved (${outcome}): ${reason}`);
    };

    // 1. Prompt injection in the arguments
    if (this.interceptors.promptInjection?.enabled !== false) {
      const scan = scanForPromptInjection(args, this.interceptors.promptInjection?.action ?? "block");
      if (scan.action === "block") return block(scan.reason);
      if (scan.action === "warn") this.log({ ...base, type: "warn", input: args, reason: scan.reason });
    }

    // 2. The live definition must still match the session pin
    const recheck = this.interceptors.definitionDrift?.recheck ?? "every-call";
    if (this.driftEnabled && (recheck === "every-call" || this.stale.has(upstream.name))) {
      try {
        const live = (await upstream.listTools()) as ToolRecord[];
        const pin = this.pinFor(upstream);
        pin.ensurePinned(live);
        const drift = pin.drifted(route.name, live);
        if (drift && this.driftAction === "block") return block(drift.reason);
        if (drift) this.log({ ...base, type: "warn", input: args, reason: drift.reason });
      } catch (err) {
        this.log({ ...base, type: "warn", reason: `definition re-check failed: ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    // 3. Policy rules
    const decision = evaluatePolicy(this.config.rules, this.config.defaults.action, {
      tool: name,
      upstream: upstream.name,
      labels,
      tainted: this.taint.tainted,
      args,
    });
    const rule = decision.ruleId ?? "defaults.action";
    if (decision.action === "deny") return block(`denied by policy rule ${rule}`, { ruleId: decision.ruleId });
    if (decision.action === "warn") {
      this.log({ ...base, type: "warn", ruleId: decision.ruleId, input: args, reason: `policy rule ${rule}` });
    }
    if (decision.action === "approve") {
      const refused = await askApproval(`policy rule ${rule} requires approval`, { ruleId: decision.ruleId });
      if (refused) return refused;
    }

    // 4. Toxic flow: untrusted + sensitive already in context, and this call can send data out
    const taintMode = this.config.taint.mode;
    // The evidence: sensitive data this session saw, now in the arguments (tokens count as their values)
    const carried = taintMode !== "off" && labels.includes("egress") ? this.fingerprints.find(this.vault.detokenize(args)) : null;
    const toxic =
      this.config.taint.basis === "data"
        ? labels.includes("egress") && this.taint.sawUntrusted && carried !== null
        : this.taint.completesTrifecta(labels);
    if (taintMode !== "off" && toxic) {
      const reason = carried ? this.taint.describeData(name, carried) : this.taint.describe(name);
      if (taintMode === "strict") {
        this.log({ ...base, type: "toxic_flow", input: args, reason: `${reason} — blocked (taint.mode=strict)` });
        return errorResult(
          `Tool call blocked: ${reason}. Start a new session to use this tool, or relabel it in the proxy config.`,
        );
      }
      if (taintMode === "approve") {
        this.log({ ...base, type: "toxic_flow", input: args, reason: `${reason} — asking for approval (taint.mode=approve)` });
        const refused = await askApproval(reason);
        if (refused) return refused;
      } else {
        this.log({ ...base, type: "toxic_flow", input: args, reason: `${reason} — allowed (taint.mode=warn)` });
      }
    }

    // 5. PII tokens go back to real values — but not into a tool that can send them out
    let forwardArgs = args;
    if (this.vault.holdsTokens(args)) {
      if (labels.includes("egress") && !this.interceptors.piiMasking?.detokenizeForEgress) {
        this.log({ ...base, type: "warn", reason: "PII tokens passed on as-is: the tool can send data out (piiMasking.detokenizeForEgress is off)" });
      } else {
        forwardArgs = this.vault.detokenize(args);
      }
    }

    // 6. Forward
    this.log({ ...base, type: "tool_call", ruleId: decision.ruleId, input: args });
    const result = await upstream.callTool(route.name, forwardArgs);

    // 7. Indirect injection in the result (text and structured)
    let content = result.content;
    if (this.interceptors.toolResultInjection?.enabled !== false) {
      const scan = scanToolResult([content, result.structuredContent ?? null], this.resultAction);
      if (scan.action === "block") {
        this.log({ ...base, type: "blocked", output: content, reason: scan.reason });
        void recordEvent({
          server: "security-proxy",
          tool: name,
          params: args,
          success: false,
          durationMs: Date.now() - started,
          error: `blocked: ${scan.reason}`,
        });
        return errorResult(`Tool result blocked: ${scan.reason}`);
      }
      if (scan.action === "warn") {
        this.log({ ...base, type: "warn", output: content, reason: scan.reason });
        content = [{ type: "text", text: `${PREFIX} Warning: ${scan.reason}` }, ...content];
      }
    }

    // 8. PII: always detected (it taints the session), masked unless turned off — a `mask` rule forces it
    const force = decision.action === "mask";
    const text = this.protect(content, force);
    let out: CallToolResult = { ...result, content: text.value };
    let piiFound = text.piiFound;
    // structuredContent usually repeats the text content: count the larger of the two, not both
    let hits = text.hits;
    if (result.structuredContent) {
      const structured = this.protect(result.structuredContent, force);
      out.structuredContent = structured.value;
      piiFound ||= structured.piiFound;
      for (const [category, count] of Object.entries(structured.hits)) hits[category] = Math.max(hits[category] ?? 0, count);
    }
    if (decision.maskFields) out = maskFields(out, decision.maskFields);

    this.taint.observe(name, labels, piiFound);
    if (labels.includes("sensitive") || piiFound) this.fingerprints.add(name, [result.content, result.structuredContent ?? null]);
    else if (this.config.taint.basis === "data") this.fingerprints.addOrdinary([result.content, result.structuredContent ?? null]);
    this.log({ ...base, type: "tool_response", output: out.content, ...(piiFound ? { piiHits: hits } : {}) });

    void recordEvent({
      server: "security-proxy",
      tool: name,
      params: args,
      success: !result.isError,
      durationMs: Date.now() - started,
    });

    return out;
  }

  async listResources(): Promise<Resource[]> {
    const listed: Resource[] = [];
    for (const upstream of this.upstreams) {
      try {
        for (const resource of await upstream.listResources()) {
          if (!this.resources.has(resource.uri)) this.resources.set(resource.uri, upstream);
          listed.push(resource);
        }
      } catch (err) {
        this.log({ type: "warn", upstream: upstream.name, reason: `resources/list failed: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
    return listed;
  }

  /** Resource contents come from outside the agent's control: they taint the session like an untrusted tool. */
  async readResource(uri: string): Promise<ReadResourceResult> {
    let upstream = this.resources.get(uri);
    if (!upstream) {
      await this.listResources();
      upstream = this.resources.get(uri) ?? (this.upstreams.length === 1 ? this.upstreams[0] : undefined);
    }
    if (!upstream) throw new Error(`${PREFIX} Unknown resource: ${uri}`);

    const result = await upstream.readResource(uri);
    const texts = result.contents.flatMap((item) => ("text" in item && typeof item.text === "string" ? [item.text] : []));
    const source = `resource:${uri}`;

    if (this.interceptors.toolResultInjection?.enabled !== false) {
      const scan = scanToolResult(texts, this.resultAction);
      if (scan.action === "block") {
        this.log({ type: "blocked", tool: source, upstream: upstream.name, reason: scan.reason });
        throw new Error(`${PREFIX} Resource blocked: ${scan.reason}`);
      }
      if (scan.action === "warn") this.log({ type: "warn", tool: source, upstream: upstream.name, reason: scan.reason });
    }

    let piiFound = false;
    const hits: PiiHits = {};
    const contents = result.contents.map((item) => {
      if (!("text" in item) || typeof item.text !== "string") return item;
      const text = this.protect(item.text);
      piiFound ||= text.piiFound;
      addHits(hits, text.hits);
      return { ...item, text: text.value };
    });

    this.taint.observe(source, ["untrusted"], piiFound);
    if (piiFound) this.fingerprints.add(source, result.contents);
    else if (this.config.taint.basis === "data") this.fingerprints.addOrdinary(result.contents);
    this.log({ type: "resource_read", tool: source, upstream: upstream.name, ...(piiFound ? { piiHits: hits } : {}) });
    return { ...result, contents };
  }

  async listPrompts(): Promise<Prompt[]> {
    const listed: Prompt[] = [];
    for (const upstream of this.upstreams) {
      try {
        for (const prompt of await upstream.listPrompts()) {
          const name = this.exposed(upstream, prompt.name);
          this.prompts.set(name, { upstream, name: prompt.name });
          listed.push({ ...prompt, name });
        }
      } catch (err) {
        this.log({ type: "warn", upstream: upstream.name, reason: `prompts/list failed: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
    return listed;
  }

  /**
   * A prompt template is text a server puts straight into the conversation, so
   * it gets the same injection scan and PII masking as a tool result. It does
   * not taint the session: the person picked it.
   */
  async getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult> {
    let route = this.prompts.get(name);
    if (!route) {
      await this.listPrompts();
      route = this.prompts.get(name);
    }
    if (!route) throw new Error(`${PREFIX} Unknown prompt: ${name}`);

    const result = await route.upstream.getPrompt(route.name, args);
    const source = `prompt:${name}`;
    if (this.interceptors.toolResultInjection?.enabled !== false) {
      const scan = scanToolResult(result.messages, this.resultAction);
      if (scan.action === "block") {
        this.log({ type: "blocked", tool: source, upstream: route.upstream.name, reason: scan.reason });
        throw new Error(`${PREFIX} Prompt blocked: ${scan.reason}`);
      }
      if (scan.action === "warn") this.log({ type: "warn", tool: source, upstream: route.upstream.name, reason: scan.reason });
    }
    return { ...result, messages: this.protect(result.messages).value };
  }

  /** End this session: stop listening to the shared upstreams. They stay open for other sessions. */
  dispose(): void {
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    this.toolListeners.length = 0;
  }

  /** Single-session mode (stdio): also close the audit log and the upstreams. */
  async close(): Promise<void> {
    this.dispose();
    await this.audit.close();
    await Promise.allSettled(this.upstreams.map((upstream) => upstream.close()));
  }
}
