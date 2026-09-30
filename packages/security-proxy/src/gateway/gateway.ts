import type {
  CallToolResult,
  GetPromptResult,
  Prompt,
  ReadResourceResult,
  Resource,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { maskPiiInText, maskPiiInValue, scanForPromptInjection, scanToolResult } from "@guardbee/guard-core";
import { recordEvent } from "@guardbee/mcp-telemetry";
import type { AuditLogger } from "../audit/logger.js";
import { stable, ToolDefinitionPin, type ToolRecord } from "../interceptors/definition-drift.js";
import type { AuditEvent } from "../types.js";
import type { GatewayConfig } from "./config.js";
import { labelTool, type Label } from "./labels.js";
import { evaluatePolicy } from "./policy.js";
import { TaintTracker } from "./taint.js";
import type { Upstream } from "./upstream.js";

const SEPARATOR = "__";
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
 * A tool call runs: input injection scan → definition drift → policy rules →
 * toxic-flow check → upstream → result injection scan → PII masking → taint update.
 */
export class Gateway {
  readonly taint = new TaintTracker();
  private readonly pins = new Map<string, ToolDefinitionPin>();
  private readonly tools = new Map<string, ToolRoute>();
  private readonly resources = new Map<string, Upstream>();
  private readonly prompts = new Map<string, { upstream: Upstream; name: string }>();

  constructor(
    private readonly upstreams: readonly Upstream[],
    private readonly config: GatewayConfig,
    private readonly audit: AuditLogger,
  ) {}

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
    this.audit.log({ ts: new Date().toISOString(), ...event, taint: this.taint.snapshot() });
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

    // 1. Prompt injection in the arguments
    if (this.interceptors.promptInjection?.enabled !== false) {
      const scan = scanForPromptInjection(args, this.interceptors.promptInjection?.action ?? "block");
      if (scan.action === "block") return block(scan.reason);
      if (scan.action === "warn") this.log({ ...base, type: "warn", input: args, reason: scan.reason });
    }

    // 2. The live definition must still match the session pin
    if (this.driftEnabled) {
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
    });
    if (decision.action === "deny") return block(`denied by policy rule ${decision.ruleId ?? "defaults.action"}`, { ruleId: decision.ruleId });
    if (decision.action === "warn") {
      this.log({ ...base, type: "warn", ruleId: decision.ruleId, input: args, reason: `policy rule ${decision.ruleId ?? "defaults.action"}` });
    }

    // 4. Toxic flow: untrusted + sensitive already in context, and this call can send data out
    if (this.config.taint.mode !== "off" && this.taint.completesTrifecta(labels)) {
      const reason = this.taint.describe(name);
      if (this.config.taint.mode === "strict") {
        this.log({ ...base, type: "toxic_flow", input: args, reason: `${reason} — blocked (taint.mode=strict)` });
        return errorResult(
          `Tool call blocked: ${reason}. Start a new session to use this tool, or relabel it in the proxy config.`,
        );
      }
      this.log({ ...base, type: "toxic_flow", input: args, reason: `${reason} — allowed (taint.mode=warn)` });
    }

    // 5. Forward
    this.log({ ...base, type: "tool_call", ruleId: decision.ruleId, input: args });
    const result = await upstream.callTool(route.name, args);

    // 6. Indirect injection in the result
    let content = result.content;
    if (this.interceptors.toolResultInjection?.enabled !== false) {
      const scan = scanToolResult(content, this.resultAction);
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

    // 7. PII: always detected (it taints the session), masked unless turned off — a `mask` rule forces it
    const masked = maskPiiInValue(content) as typeof content;
    const piiFound = stable(masked) !== stable(content);
    if (this.interceptors.piiMasking?.enabled !== false || decision.action === "mask") content = masked;

    this.taint.observe(name, labels, piiFound);
    this.log({ ...base, type: "tool_response", output: content });

    void recordEvent({
      server: "security-proxy",
      tool: name,
      params: args,
      success: !result.isError,
      durationMs: Date.now() - started,
    });

    return { ...result, content };
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
    const contents = result.contents.map((item) => {
      if (!("text" in item) || typeof item.text !== "string") return item;
      const text = maskPiiInText(item.text);
      if (text !== item.text) piiFound = true;
      return this.interceptors.piiMasking?.enabled !== false ? { ...item, text } : item;
    });

    this.taint.observe(source, ["untrusted"], piiFound);
    this.log({ type: "resource_read", tool: source, upstream: upstream.name });
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

  async getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult> {
    let route = this.prompts.get(name);
    if (!route) {
      await this.listPrompts();
      route = this.prompts.get(name);
    }
    if (!route) throw new Error(`${PREFIX} Unknown prompt: ${name}`);
    return route.upstream.getPrompt(route.name, args);
  }

  async close(): Promise<void> {
    this.audit.close();
    await Promise.allSettled(this.upstreams.map((upstream) => upstream.close()));
  }
}
