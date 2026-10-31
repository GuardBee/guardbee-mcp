import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import type {
  CallToolResult,
  CreateMessageRequest,
  CreateMessageResult,
  GetPromptResult,
  Prompt,
  ReadResourceResult,
  Resource,
  Tool,
} from "@modelcontextprotocol/server";
import {
  detectTopics,
  maskPiiInValue,
  MODEL_PII,
  MODEL_PII_REPLACEMENT,
  SPECIAL_CATEGORIES,
  SPECIAL_CATEGORY_REPLACEMENT,
  OPT_IN_PII,
  PiiPatternTimeoutError,
  type OrgPatternEvent,
  PERSONAL_DATA_CATEGORIES,
  PII_PATTERNS,
  scanForPromptInjection,
  scanToolCatalog,
  scanToolResult,
  type CatalogFinding,
  type SpanLookup,
} from "@guardbee/guard-core";
import { recordEvent } from "@guardbee/mcp-telemetry";
import { context, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { activeCallSpan, tracer, withCallSpan } from "../tracing.js";
import type { AuditLogger } from "../audit/logger.js";
import { ToolDefinitionPin, type ToolRecord } from "../interceptors/definition-drift.js";
import { describeChange, type PinChange, type PinStore } from "./pin-store.js";
import type { AuditEvent } from "../types.js";
import { orgPatternsFor, piiScopesFor, type PiiScopes } from "./pii-scope.js";
import { AnomalyDetector, type AnomalyConfig } from "./anomaly.js";
import { ApprovalRequired, approvalKey, type ApprovalRequest, type Approver, type DeferredApprovals } from "./approval.js";
import type { GatewayConfig } from "./config.js";
import { judgeFor, secondOpinion } from "./judge.js";
import { classifierFor, classifyInjection } from "./classifier.js";
import { callerStorage, currentCaller, type CallerScope } from "./caller-context.js";
import { CONNECT_TOOL } from "./authenticated-upstream.js";
import { maskFields } from "./fields.js";
import { labelTool, type Label } from "./labels.js";
import { DataFingerprints } from "./fingerprints.js";
import { evaluatePolicy, evaluateTopicRules, globToRegExp } from "./policy.js";
import { QuotaStore } from "./quota.js";
import { TaintTracker } from "./taint.js";
import { NerError, nerDetectorFor, scanNames } from "./ner.js";
import { PiiVault } from "./tokens.js";
import type { CallOptions, Upstream } from "./upstream.js";

const SEPARATOR = "__";

/** The agent's client, for answering servers' sampling requests (see interceptors.sampling). */
export interface Sampler {
  /** The client declared the sampling capability. */
  available(): boolean;
  create(params: CreateMessageRequest["params"]): Promise<CreateMessageResult>;
}

/** The person behind an HTTP session, from their OIDC token. */
export interface CallerIdentity {
  user: string;
  groups: string[];
  /** The caller's inbound access token, for upstreams with auth.mode token-exchange. Never logged or forwarded. */
  token?: string;
}

/** Pattern names that are personal data; every other PII pattern is a credential and counts as "secret". */
const PERSONAL_DATA = new Set<string>([...PERSONAL_DATA_CATEGORIES, ...MODEL_PII, ...SPECIAL_CATEGORIES]);

/** Base64 bytes in a content item: an image, an embedded resource or a resource's blob. */
function blobOf(item: { type?: string }): { data: string; label: string } | null {
  const record = item as Record<string, unknown>;
  if (record["type"] === "image" && typeof record["data"] === "string") {
    return { data: record["data"], label: `image (${typeof record["mimeType"] === "string" ? record["mimeType"] : "unknown type"})` };
  }
  // An embedded resource nests it under `resource`; a resources/read item is the resource itself
  const nested = record["resource"];
  const resource = (typeof nested === "object" && nested !== null ? nested : record) as Record<string, unknown>;
  if (typeof resource["blob"] === "string") {
    return { data: resource["blob"], label: typeof resource["uri"] === "string" ? resource["uri"] : "embedded document" };
  }
  return null;
}
const PLACEHOLDER = new Map<string, string>([...PII_PATTERNS.map((p) => [p.name, p.replacement] as const), ...Object.entries(MODEL_PII_REPLACEMENT), ...Object.entries(SPECIAL_CATEGORY_REPLACEMENT)]);

type PiiHits = Record<string, number>;

function addHits(into: PiiHits, from: PiiHits): PiiHits {
  for (const [category, count] of Object.entries(from)) into[category] = (into[category] ?? 0) + count;
  return into;
}
const PREFIX = "[GuardBee Security Proxy]";
/** Stable code in a ProtocolError's data when a result is withheld because masking failed (same as the LLM gateway's). */
const MASKING_FAILED = "guardbee_masking_failed";

interface ToolRoute {
  upstream: Upstream;
  /** The tool's name on its own server. */
  name: string;
  labels: Label[];
  /** Why the definition is held back as poisoned; the tool is hidden and its calls refused. */
  poisoned?: string;
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text: `${PREFIX} ${text}` }], isError: true };
}

/**
 * The policy pipeline between the agent and its MCP servers. Transport-free:
 * proxy.ts wires it to stdio, tests drive it directly.
 *
 * tools/list scans each definition for poisoning before the agent sees it.
 * A tool call runs: exposure / poisoning → session anomaly checks → input injection scan →
 * definition drift → policy rules (incl. approval) → toxic-flow check →
 * detokenize → credentials leaving → quotas → upstream → result injection scan → PII masking / tokenizing →
 * field masking → taint update. Sampling requests the server sends during the
 * call are answered through sample().
 */
export class Gateway {
  readonly taint = new TaintTracker();
  readonly vault = new PiiVault();
  /** Hashes of the sensitive data this session's tools returned, for the data-based taint check. */
  readonly fingerprints = new DataFingerprints();
  private anomalyDetector: AnomalyDetector | null = null;
  /** The interceptors.anomaly object the detector was built from; a policy update replaces it. */
  private anomalyConfig?: AnomalyConfig;
  private readonly now?: () => number;
  private readonly pins = new Map<string, ToolDefinitionPin>();
  /** Shared by every session of the process; absent when definitions are not persisted. */
  private readonly pinStore?: PinStore;
  /** Tools whose definition differs from the persisted one, per upstream, until approved. */
  private readonly unpinned = new Map<string, Map<string, PinChange>>();
  private readonly tools = new Map<string, ToolRoute>();
  private readonly resources = new Map<string, Upstream>();
  private readonly prompts = new Map<string, { upstream: Upstream; name: string }>();
  /** Poisoning findings already logged, by tool and finding, so each list does not log them again. */
  private readonly poisonLogged = new Set<string>();
  /** Upstreams that announced tools/list_changed since the agent last listed tools. */
  private readonly stale = new Set<string>();
  private readonly toolListeners: (() => void)[] = [];
  private readonly unsubscribers: (() => void)[] = [];
  private readonly sessionId?: string;
  private identity?: CallerIdentity;
  private readonly sampler?: Sampler;
  /** Shared by every session of the process over HTTP; this session's own over stdio. */
  private readonly quotas: QuotaStore;

  /**
   * One Gateway per agent session: taint, PII tokens and pins are per session.
   * Over HTTP several sessions share the same upstream connections.
   */
  constructor(
    private readonly upstreams: readonly Upstream[],
    readonly config: GatewayConfig,
    private readonly audit: AuditLogger,
    private readonly approver?: Approver,
    options: { sessionId?: string; identity?: CallerIdentity; sampler?: Sampler; quotas?: QuotaStore; now?: () => number; pinStore?: PinStore } = {},
  ) {
    this.pinStore = options.pinStore;
    this.quotas = options.quotas ?? new QuotaStore(options.now);
    this.sessionId = options.sessionId;
    this.identity = options.identity;
    this.sampler = options.sampler;
    this.now = options.now;
    for (const upstream of upstreams) {
      const unsubscribe = upstream.onToolsChanged?.(() => {
        this.stale.add(upstream.name);
        for (const listener of this.toolListeners) listener();
      });
      if (unsubscribe) this.unsubscribers.push(unsubscribe);
    }
  }

  /**
   * A 2026-07-28 context is reused across requests: the groups come from the
   * latest token (and directory). The user stays the same, it keys the context.
   */
  /** What upstreams with per-user auth see of this caller while a request runs. */
  private callerScope(): CallerScope {
    return { ...(this.identity?.user ? { user: this.identity.user } : {}), ...(this.identity?.token ? { token: this.identity.token } : {}) };
  }

  setIdentity(identity: CallerIdentity | undefined): void {
    if (identity?.user !== this.identity?.user) throw new Error("a context belongs to one user");
    this.identity = identity;
  }

  /** Called when any upstream's tool list changed; proxy.ts relays it to the agent. */
  onToolsChanged(listener: () => void): () => void {
    this.toolListeners.push(listener);
    return () => {
      const at = this.toolListeners.indexOf(listener);
      if (at !== -1) this.toolListeners.splice(at, 1);
    };
  }

  private get interceptors() {
    return this.config.interceptors;
  }

  /** Behaviour over this session's calls (bursts, sweeps, probing); null when interceptors.anomaly is off. */
  private get anomaly(): AnomalyDetector | null {
    const config = this.interceptors.anomaly;
    // A dashboard policy update swaps the object: start counting under the new limits.
    if (config !== this.anomalyConfig) {
      this.anomalyConfig = config;
      this.anomalyDetector = config?.enabled ? new AnomalyDetector(config, this.now) : null;
    }
    return this.anomalyDetector;
  }

  /** Left out of tools/list and refused: not in `tools.expose` (when set), or in `tools.hide`. */
  private hidden(name: string): boolean {
    const { expose, hide } = this.config.tools;
    const matches = (glob: string) => globToRegExp(glob).test(name);
    return (expose !== undefined && !expose.some(matches)) || hide.some(matches);
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
    // Inside a tool call, every audit event is also an event on its span
    const span = activeCallSpan();
    if (span) {
      span.addEvent(`guardbee.${event.type}`, {
        ...(event.tool ? { "gen_ai.tool.name": event.tool } : {}),
        ...(event.ruleId ? { "guardbee.rule_id": event.ruleId } : {}),
        ...(event.reason ? { "guardbee.reason": event.reason } : {}),
      });
      if (event.type === "blocked" || event.type === "toxic_flow") span.setAttribute(`guardbee.${event.type}`, true);
    }
    this.audit.log({
      ts: new Date().toISOString(),
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      ...(this.identity ? { user: this.identity.user } : {}),
      ...event,
      taint: this.taint.snapshot(),
    });
  }

  /**
   * Poisoning findings per tool, from what the model would read: your own
   * description when you set one, otherwise the server's, plus the schema.
   */
  private poisoning(upstream: Upstream, tools: Tool[]): Map<string, CatalogFinding[]> {
    const byTool = new Map<string, CatalogFinding[]>();
    if (this.interceptors.toolPoisoning?.enabled === false) return byTool;
    const seen = tools.map((tool) => ({
      name: tool.name,
      description: this.config.tools.descriptions[this.exposed(upstream, tool.name)] ?? tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    }));
    for (const finding of scanToolCatalog(seen, upstream.name)) {
      const list = byTool.get(finding.toolName) ?? [];
      list.push(finding);
      byTool.set(finding.toolName, list);
    }
    return byTool;
  }

  private get poisoningAction(): "block" | "warn" {
    return this.interceptors.toolPoisoning?.action ?? this.interceptors.promptInjection?.action ?? "block";
  }

  /** Credential pattern names in a value (personal data is left to PII masking). */
  private credentialsIn(value: unknown): string[] {
    const names = new Set<string>();
    maskPiiInValue(value, (name) => {
      if (!PERSONAL_DATA.has(name)) names.add(name);
      return "";
    });
    return [...names];
  }

  private get driftEnabled(): boolean {
    return this.interceptors.definitionDrift?.enabled !== false;
  }

  private get driftAction(): "block" | "warn" {
    return this.interceptors.definitionDrift?.action ?? this.interceptors.promptInjection?.action ?? "block";
  }

  private get pinAction(): "block" | "approve" | "warn" {
    return this.interceptors.definitionDrift?.onChange ?? "approve";
  }

  /**
   * Compare an upstream's list with its persisted pins. A changed tool is shown
   * with its approved definition and an added one left out (block) or shown
   * (approve: the call asks first); warn logs and shows the new list.
   */
  private checkPersistentPins(upstream: Upstream, tools: Tool[]): Tool[] {
    if (!this.pinStore || !this.driftEnabled) return tools;
    const { firstUse, changes } = this.pinStore.check(upstream.name, tools as ToolRecord[]);
    // First use: the store pinned the list as it is
    if (firstUse) return tools;
    const pending = new Map<string, PinChange>();
    for (const change of changes) {
      const tool = this.exposed(upstream, change.tool);
      const hashes = change.kind === "changed" ? ` (pinned ${change.pinned.hash.slice(0, 12)}, now ${change.currentHash.slice(0, 12)})` : "";
      const action = change.kind === "removed" ? "warn" : this.pinAction;
      this.log({
        type: action === "block" ? "blocked" : "warn",
        tool,
        server: upstream.name,
        upstream: upstream.name,
        ruleId: `pin:${change.kind}`,
        reason: `${describeChange(change).split("\n")[0]}${hashes} (MCP03:2025)${action === "warn" ? "" : ` — run: guardbee-proxy pins approve ${upstream.name} ${change.tool}`}`,
        // Hashed in the audit log unless audit.includePayloads
        input: { change: describeChange(change) },
      });
      if (change.kind !== "removed" && this.pinAction !== "warn") pending.set(change.tool, change);
    }
    this.unpinned.set(upstream.name, pending);
    if (this.pinAction === "warn") return tools;
    const out: Tool[] = [];
    for (const tool of tools) {
      const change = pending.get(tool.name);
      if (!change) out.push(tool);
      // The agent keeps seeing what was approved, not the rewritten description
      else if (change.kind === "changed") out.push({ ...tool, ...change.pinned.snapshot } as Tool);
      else if (this.pinAction === "approve") out.push(tool);
    }
    return out;
  }

  private get resultAction(): "block" | "warn" {
    return this.interceptors.toolResultInjection?.action ?? this.interceptors.promptInjection?.action ?? "block";
  }

  /**
   * Find PII in a value (it taints the session either way) and hide it unless
   * masking is off. `force` comes from a `mask` rule and overrides "off".
   */
  /**
   * Images and blobs (embedded resources, resource contents) read with the
   * document scanner: a PDF's text layer, OCR for images and scanned pages.
   * `block` replaces a document holding PII or a credential with a notice.
   */
  private async scanDocuments<T extends { type: string }>(
    items: T[],
    base: { tool?: string; server?: string; upstream?: string; labels?: string[] },
  ): Promise<{ content: T[]; hits: PiiHits }> {
    const config = this.interceptors.documents!;
    const { scanBytes } = await import("@guardbee/mcp-document-scanner");
    const hits: PiiHits = {};
    const out: T[] = [];
    for (const item of items) {
      const blob = blobOf(item);
      if (!blob) {
        out.push(item);
        continue;
      }
      const result = await scanBytes(new Uint8Array(Buffer.from(blob.data, "base64")), blob.label, {
        ocr: config.ocr !== false,
        ...(config.maxBytes ? { maxBytes: config.maxBytes } : {}),
        include: OPT_IN_PII.filter((name) => this.piiScopes(base.upstream).detect.has(name)),
      });
      for (const note of result.notes) this.log({ ...base, type: "warn", ruleId: "documents:unread", reason: `${blob.label}: ${note}` });
      if (result.findings.length === 0) {
        out.push(item);
        continue;
      }
      const found: PiiHits = {};
      for (const finding of result.findings) {
        const category = PERSONAL_DATA.has(finding.detector) ? finding.detector : "secret";
        found[category] = (found[category] ?? 0) + 1;
      }
      addHits(hits, found);
      const summary = Object.entries(found).map(([category, count]) => `${category} ×${count}`).join(", ");
      if (config.action === "block") {
        this.log({ ...base, type: "blocked", ruleId: "documents:pii", reason: `${blob.label} withheld: it holds ${summary}` });
        out.push({ type: "text", text: `${PREFIX} ${blob.label} withheld: it holds ${summary}` } as unknown as T);
      } else {
        this.log({ ...base, type: "warn", ruleId: "documents:pii", reason: `${blob.label} holds ${summary}` });
        out.push(item);
      }
    }
    return { content: out, hits };
  }

  /** Ids of the topics a value is about; skipped while no rule names a topic. */
  private topicsOf(value: unknown): string[] {
    const topics = this.config.topics ?? [];
    if (topics.length === 0 || !this.config.rules.some((rule) => rule.match.topic !== undefined)) return [];
    return detectTopics(value, topics).map((hit) => hit.id);
  }

  /**
   * Topic rules on what came back (a tool result, resource or prompt), so a
   * subject that only shows up in the answer is caught too. `already` is the
   * rule that decided the call itself: it is not applied twice.
   */
  private async topicsAfter(
    source: string,
    upstream: Upstream,
    value: unknown,
    labels: readonly Label[],
    args: Record<string, unknown> = {},
    already?: string,
    deferred?: DeferredApprovals,
  ): Promise<{ withheld?: string; force: boolean; maskFields?: string[] }> {
    const topics = this.topicsOf(value);
    const decision = evaluateTopicRules(this.config.rules, {
      tool: source,
      upstream: upstream.name,
      labels,
      tainted: this.taint.tainted,
      args,
      topics,
      ...(this.identity ? { user: this.identity.user, groups: this.identity.groups } : {}),
    });
    if (!decision || decision.ruleId === already) return { force: false };
    const reason = `it is about ${topics.join(", ")} (policy rule ${decision.ruleId})`;
    const base = { tool: source, server: upstream.name, upstream: upstream.name, labels: [...labels], ruleId: decision.ruleId };
    switch (decision.action) {
      case "deny":
        this.log({ ...base, type: "blocked", reason: `withheld: ${reason}` });
        return { withheld: reason, force: false };
      case "warn":
        this.log({ ...base, type: "warn", reason });
        return { force: false };
      case "mask":
        return { force: true, ...(decision.maskFields ? { maskFields: decision.maskFields } : {}) };
      case "approve": {
        const outcome = this.approver
          ? await this.approver({ tool: source, upstream: upstream.name, args, reason: `the answer ${reason}`, phase: "result", ...(this.sessionId ? { sessionId: this.sessionId } : {}), ...(deferred ? { deferred } : {}) })
          : "unavailable";
        this.log({ ...base, type: "approval", reason: `${outcome}: ${reason}` });
        return outcome === "approved" ? { force: false } : { withheld: `${reason}; not approved (${outcome})`, force: false };
      }
      default:
        return { force: false };
    }
  }

  private async protect<T>(value: T, force: boolean, where: { upstream: string; tool: string }): Promise<{ value: T; piiFound: boolean; hits: PiiHits }> {
    const enabled = this.interceptors.piiMasking?.enabled !== false || force;
    // Names first: the model is asked once for every string in the value. When it
    // cannot answer, nothing goes out — the value may hold a name no regex knows.
    let names: SpanLookup | undefined;
    if (enabled && this.config.ner) {
      try {
        names = await scanNames(nerDetectorFor(this.config.ner), value);
      } catch (err) {
        const reason = err instanceof NerError ? `name detection failed: ${err.message}` : `name detection failed (${err instanceof Error ? err.name : typeof err})`;
        this.log({ ...where, type: "blocked", ruleId: "pii:ner-failed", reason });
        throw new ProtocolError(ProtocolErrorCode.InternalError, `${PREFIX} Result withheld: ${reason}`, { guardbee: MASKING_FAILED });
      }
    }
    const scopes = this.piiScopes(where.upstream);
    const org = orgPatternsFor(this.interceptors.piiMasking);
    const hits: PiiHits = {};
    const onEvent = (event: OrgPatternEvent) =>
      this.log({
        ...where,
        type: "warn",
        ruleId: event.type === "allowed" ? "pii:allow" : "pii:allow-skipped",
        reason:
          event.type === "allowed"
            ? `allow pattern ${JSON.stringify(event.pattern)} kept a ${event.detector} value unmasked`
            : `allow pattern ${JSON.stringify(event.pattern)} ran over its time budget and was skipped`,
      });
    try {
      // Every detector counts (taint, piiHits); only the selected ones and org block patterns mask
      const redacted = org.withEvents(onEvent, () =>
        maskPiiInValue(value, (name, match) => {
          const custom = org.categories.has(name);
          const category = custom ? name : PERSONAL_DATA.has(name) ? name : "secret";
          hits[category] = (hits[category] ?? 0) + 1;
          if (custom) return undefined;
          return scopes.mask.has(name) ? (PLACEHOLDER.get(name) ?? "[REDACTED]") : match;
        }, scopes.detect, org, names),
      ) as T;
      const piiFound = Object.keys(hits).length > 0;
      if (!piiFound || !enabled) return { value, piiFound, hits };
      const tokenize = this.interceptors.piiMasking?.mode === "tokenize";
      return { value: tokenize ? this.vault.tokenize(value, scopes.mask, org, names) : redacted, piiFound, hits };
    } catch (err) {
      // Fail closed: a detector that threw or a block pattern that did not finish may have
      // missed something. The error's own message may quote the result, so it goes nowhere.
      const timeout = err instanceof PiiPatternTimeoutError;
      const reason = timeout ? err.message : `masking failed (${err instanceof Error ? err.name : typeof err})`;
      this.log({ ...where, type: "blocked", ruleId: timeout ? "pii:pattern-timeout" : "pii:masking-failed", reason });
      throw new ProtocolError(ProtocolErrorCode.InternalError, `${PREFIX} Result withheld: ${reason}`, { guardbee: MASKING_FAILED });
    }
  }

  /** piiMasking's preset / enable / disable for this upstream (see gateway/pii-scope.ts). */
  private piiScopes(upstream?: string): PiiScopes {
    return piiScopesFor(this.interceptors.piiMasking, upstream);
  }

  async listTools(): Promise<Tool[]> {
    return callerStorage.run(this.callerScope(), () => this.listToolsAs());
  }

  private async listToolsAs(): Promise<Tool[]> {
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
      // A per-user upstream the caller has not connected yet offers only its connect tool: not a definition to pin
      if (tools.length === 1 && tools[0]!.name === CONNECT_TOOL && !tools[0]!.outputSchema) {
        const name = this.exposed(upstream, CONNECT_TOOL);
        this.tools.set(name, { upstream, name: CONNECT_TOOL, labels: [] });
        listed.push({ ...tools[0]!, name });
        continue;
      }
      tools = this.checkPersistentPins(upstream, tools);
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
      const poisoning = this.poisoning(upstream, tools);
      for (const tool of tools) {
        const name = this.exposed(upstream, tool.name);
        const labels = this.config.labels[name] ?? labelTool(tool);
        const findings = poisoning.get(tool.name) ?? [];
        // Medium findings only warn: they are the patterns most likely to be benign wording.
        const blocking = this.poisoningAction === "block" ? findings.filter((f) => f.severity !== "medium") : [];
        const poisoned = blocking.length > 0 ? `Tool poisoning in "${name}": ${blocking.map((f) => `${f.patternName} (${f.field})`).join("; ")}` : undefined;
        this.tools.set(name, { upstream, name: tool.name, labels, ...(poisoned ? { poisoned } : {}) });
        for (const finding of findings) {
          const key = `${name}\0${finding.patternId}\0${finding.field}\0${finding.match}`;
          if (this.poisonLogged.has(key)) continue;
          this.poisonLogged.add(key);
          const held = blocking.includes(finding);
          this.log({
            type: held ? "blocked" : "warn",
            tool: name,
            server: upstream.name,
            upstream: upstream.name,
            ruleId: `poisoning:${finding.patternId}`,
            reason: `Tool poisoning (${finding.severity}) in ${finding.field}: ${finding.patternName}${held ? " — tool hidden" : ""}`,
          });
        }
        if (poisoned || this.hidden(name)) continue;
        const description = this.config.tools.descriptions[name];
        listed.push({ ...tool, name, ...(description ? { description } : {}) });
      }
    }
    return listed;
  }

  /** One span per call (MCP semantic conventions); the audit events of the call become its events. */
  async callTool(name: string, args: Record<string, unknown>, options: { deferred?: DeferredApprovals } = {}): Promise<CallToolResult> {
    return callerStorage.run(this.callerScope(), () => this.callToolAs(name, args, options));
  }

  private async callToolAs(name: string, args: Record<string, unknown>, options: { deferred?: DeferredApprovals } = {}): Promise<CallToolResult> {
    const span = tracer().startSpan(`tools/call ${name}`, {
      kind: SpanKind.SERVER,
      attributes: {
        "mcp.method.name": "tools/call",
        "gen_ai.operation.name": "execute_tool",
        "gen_ai.tool.name": name,
        ...(this.sessionId ? { "mcp.session.id": this.sessionId } : {}),
        ...(this.identity ? { "enduser.id": this.identity.user } : {}),
      },
    });
    try {
      const result = await withCallSpan(span, () => this.handleCall(name, args, options.deferred));
      if (result.isError) span.setAttribute("error.type", "tool_error");
      return result;
    } catch (err) {
      // Not a failure: the call goes back to the client for an approval
      if (err instanceof ApprovalRequired) {
        span.setAttribute("guardbee.approval", "input-required");
        throw err;
      }
      span.recordException(err instanceof Error ? err : String(err));
      span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      span.end();
    }
  }

  private async handleCall(name: string, args: Record<string, unknown>, deferred?: DeferredApprovals): Promise<CallToolResult> {
    const started = Date.now();
    let route = this.tools.get(name);
    if (!route) {
      await this.listTools();
      route = this.tools.get(name);
    }
    if (!route) return errorResult(`Unknown tool: ${name}`);

    const { upstream, labels } = route;
    const base = { tool: name, server: upstream.name, upstream: upstream.name, labels };
    activeCallSpan()?.setAttributes({ "guardbee.upstream": upstream.name, "guardbee.labels": labels });
    /** A refused call counts toward the repeated-blocks check. */
    const countRefusal = (): void => {
      const anomaly = this.anomaly?.observeBlocked(name);
      if (!anomaly?.fresh) return;
      const locked = this.anomaly!.locked;
      this.log({
        ...base,
        type: locked ? "blocked" : "warn",
        ruleId: `anomaly:${anomaly.kind}`,
        reason: locked ?? anomaly.reason,
      });
    };
    const block = (reason: string, extra: Partial<AuditEvent> = {}, counts = true): CallToolResult => {
      this.log({ ...base, type: "blocked", input: args, reason, ...extra });
      if (counts) countRefusal();
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
      const request: ApprovalRequest = { tool: name, upstream: upstream.name, args, reason, phase: "call", ...(this.sessionId ? { sessionId: this.sessionId } : {}), ...(deferred ? { deferred } : {}) };
      const outcome = this.approver ? await this.approver(request) : "unavailable";
      this.log({ ...base, type: "approval", input: args, reason: `${outcome}: ${reason}`, ...extra });
      // Asked in the call's answer; the client sends the call again with it
      if (outcome === "input-required") throw new ApprovalRequired(request, approvalKey(request));
      if (outcome === "approved") return null;
      // A client that cannot show the prompt is not probing the policy.
      if (outcome !== "unavailable") countRefusal();
      if (outcome === "unavailable") {
        return errorResult(
          `Tool call blocked: it needs a person's approval, but this client cannot show an approval prompt (MCP elicitation). ${reason}`,
        );
      }
      return errorResult(`Tool call not approved (${outcome}): ${reason}`);
    };

    // 0. A hidden tool is not there for the agent; asking for it anyway counts as probing
    if (this.hidden(name)) return block(`"${name}" is not exposed by this gateway (tools.expose / tools.hide)`);
    if (route.poisoned) return block(`${route.poisoned} — the tool is held back`);

    // Session behaviour: a locked session, a burst, a sweep of sensitive reads
    if (this.anomaly) {
      if (this.anomaly.locked) return block(this.anomaly.locked, { ruleId: "anomaly:repeated_blocks" }, false);
      // A 2026-07-28 approval round sends the same call again: count it once
      for (const anomaly of deferred?.retry ? [] : this.anomaly.observeCall(name, labels, args)) {
        const ruleId = `anomaly:${anomaly.kind}`;
        if (this.anomaly.blocking) return block(anomaly.reason, { ruleId }, false);
        if (anomaly.fresh) this.log({ ...base, type: "warn", ruleId, input: args, reason: anomaly.reason });
      }
    }

    // 1. Prompt injection in the arguments
    if (this.interceptors.promptInjection?.enabled !== false) {
      const mode = this.interceptors.promptInjection?.action ?? "block";
      let scan = scanForPromptInjection(args, mode);
      if (scan.action === "block") return block(scan.reason);
      // The classifier (when configured): a fast first pass over what the rules let through
      const classifier = classifierFor(this.config.classifier, "arguments");
      let classified: AuditEvent["classifier"];
      if (classifier) {
        const result = await classifyInjection(this.config.classifier!, classifier, args, scan, mode);
        if (result.audit) classified = result.audit;
        scan = result.scan;
        if (scan.action === "block") return block(scan.reason, { ruleId: "classifier:injection", ...(classified ? { classifier: classified } : {}) });
      }
      if (scan.action === "warn") {
        // Borderline: the judge (when configured) gives a second opinion
        const judge = judgeFor(this.config.judge);
        const second = judge ? await secondOpinion(this.config.judge!, judge, args, "tool argument", scan.reason, mode) : undefined;
        if (second?.action === "block") return block(second.reason, { ruleId: "judge:injection", judge: second.judge, ...(classified ? { classifier: classified } : {}) });
        this.log({ ...base, type: "warn", input: args, reason: second?.reason ?? scan.reason, ...(second ? { judge: second.judge } : {}), ...(classified ? { classifier: classified } : {}) });
      }
    }

    // 1b. A definition that changed since it was approved (persistent pins)
    const unpinned = this.unpinned.get(upstream.name)?.get(route.name);
    if (unpinned && unpinned.kind !== "removed" && this.pinStore) {
      const reason = `${describeChange(unpinned)}\n(MCP03:2025; or run: guardbee-proxy pins approve ${upstream.name} ${route.name})`;
      if (this.pinAction === "block") return block(reason.replace(/\n/g, " "), { ruleId: `pin:${unpinned.kind}` });
      const refused = await askApproval(reason, { ruleId: `pin:${unpinned.kind}` });
      if (refused) return refused;
      // The approval event above is the record; from now on this definition is the pinned one
      this.pinStore.approve(upstream.name, [unpinned.current]);
      this.unpinned.get(upstream.name)?.delete(route.name);
      // The session pinned the approved definition the agent was shown; it now holds the new one
      this.pinFor(upstream).repin(unpinned.current as ToolRecord & { name: string });
    }

    // 2. The live definition must still match the session pin
    const recheck = this.interceptors.definitionDrift?.recheck ?? "every-call";
    // The connect placeholder of a per-user upstream is not a pinned definition
    if (this.driftEnabled && route.name !== CONNECT_TOOL && (recheck === "every-call" || this.stale.has(upstream.name))) {
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
      topics: this.topicsOf(args),
      ...(this.identity ? { user: this.identity.user, groups: this.identity.groups } : {}),
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
        countRefusal();
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

    // 5b. A credential on its way out: what the server would actually receive
    const egressSecrets = this.interceptors.egressSecrets;
    if (labels.includes("egress") && egressSecrets?.enabled !== false) {
      const found = this.credentialsIn(forwardArgs);
      const exempt = (egressSecrets?.allowTools ?? []).some((glob) => globToRegExp(glob).test(name));
      if (found.length > 0 && !exempt) {
        const reason = `credential in the arguments of "${name}", which can send data out (${found.join(", ")})`;
        // Never write the credential itself into the audit log
        const input = maskPiiInValue(args, (pattern) => PLACEHOLDER.get(pattern) ?? "[REDACTED]");
        if ((egressSecrets?.action ?? this.interceptors.promptInjection?.action ?? "block") === "block") {
          return block(reason, { ruleId: "egress:credential", input });
        }
        this.log({ ...base, type: "warn", ruleId: "egress:credential", input, reason });
      }
    }

    // 5c. Quotas: only a call that is about to go out counts
    if (this.config.quotas.length > 0) {
      const over = await this.quotas.take(this.config.quotas, {
        tool: name,
        upstream: upstream.name,
        labels,
        ...(this.sessionId ? { sessionId: this.sessionId } : {}),
        ...(this.identity ? { user: this.identity.user, groups: this.identity.groups } : {}),
      });
      // A full quota is not probing: it does not count toward anomaly.repeatedBlocks
      if (over) return block(over.reason, { ruleId: `quota:${over.ruleId}` }, false);
    }

    // 6. Forward
    this.log({ ...base, type: "tool_call", ruleId: decision.ruleId, input: args });
    const parent = activeCallSpan();
    const upstreamSpan = tracer().startSpan(
      `tools/call ${route.name}`,
      { kind: SpanKind.CLIENT, attributes: { "mcp.method.name": "tools/call", "gen_ai.tool.name": route.name, "server.address": upstream.name } },
      parent ? trace.setSpan(context.active(), parent) : undefined,
    );
    let result: CallToolResult;
    try {
      result = await upstream.callTool(route.name, forwardArgs, this.samplingFor(upstream, name, deferred));
      if (result.isError) upstreamSpan.setAttribute("error.type", "tool_error");
    } catch (err) {
      upstreamSpan.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      upstreamSpan.end();
    }

    // 7. Indirect injection in the result (text and structured)
    let content = result.content;
    if (this.interceptors.toolResultInjection?.enabled !== false) {
      let scan = scanToolResult([content, result.structuredContent ?? null], this.resultAction);
      let judged: AuditEvent["judge"];
      let classified: AuditEvent["classifier"];
      const classifier = scan.action !== "block" ? classifierFor(this.config.classifier, "results") : undefined;
      if (classifier) {
        const c = await classifyInjection(this.config.classifier!, classifier, [content, result.structuredContent ?? null], scan, this.resultAction);
        classified = c.audit;
        scan = c.scan;
      }
      // Borderline (the rules warned), or with judge.scope: results every result the rules let through
      const judge = scan.action === "warn" || (scan.action === "allow" && this.config.judge?.scope === "results") ? judgeFor(this.config.judge) : undefined;
      if (judge && scan.action !== "block") {
        const ruleReason = scan.action === "warn" ? scan.reason : "Indirect prompt injection in tool result (MCP06:2025): no rule matched";
        const second = await secondOpinion(this.config.judge!, judge, [content, result.structuredContent ?? null], "tool result", ruleReason, this.resultAction, scan.action);
        judged = second.judge;
        // A borderline finding the judge cleared (mayClear) stays on record
        if (second.action === "allow" && scan.action === "warn") this.log({ ...base, type: "warn", output: content, reason: second.reason, judge: second.judge });
        scan = second.action === "allow" ? { action: "allow" } : { action: second.action, reason: second.reason };
      }
      if (scan.action === "block") {
        this.log({ ...base, type: "blocked", output: content, reason: scan.reason, ...(judged ? { ruleId: "judge:injection", judge: judged } : classified ? { ruleId: "classifier:injection" } : {}), ...(classified ? { classifier: classified } : {}) });
        countRefusal();
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
        this.log({ ...base, type: "warn", output: content, reason: scan.reason, ...(judged ? { judge: judged } : {}), ...(classified ? { classifier: classified } : {}) });
        content = [{ type: "text", text: `${PREFIX} Warning: ${scan.reason}` }, ...content];
      }
    }

    // 7a. Documents: PII inside images, PDFs and blobs that the text checks cannot see
    let documentHits: PiiHits = {};
    if (this.interceptors.documents?.enabled) {
      const scanned = await this.scanDocuments(content, base);
      content = scanned.content;
      documentHits = scanned.hits;
    }

    // 7b. Topic rules on the result: a subject that only shows up in the answer
    const topical = await this.topicsAfter(name, upstream, [content, result.structuredContent ?? null], labels, args, decision.ruleId, deferred);
    if (topical.withheld) {
      countRefusal();
      return errorResult(`Tool result withheld: ${topical.withheld}`);
    }

    // 8. PII: always detected (it taints the session), masked unless turned off — a `mask` rule forces it
    const force = decision.action === "mask" || topical.force;
    const text = await this.protect(content, force, { upstream: upstream.name, tool: name });
    let out: CallToolResult = { ...result, content: text.value };
    let piiFound = text.piiFound;
    // structuredContent usually repeats the text content: count the larger of the two, not both
    let hits = text.hits;
    if (result.structuredContent) {
      const structured = await this.protect(result.structuredContent, force, { upstream: upstream.name, tool: name });
      out.structuredContent = structured.value;
      piiFound ||= structured.piiFound;
      for (const [category, count] of Object.entries(structured.hits)) hits[category] = Math.max(hits[category] ?? 0, count);
    }
    if (Object.keys(documentHits).length > 0) {
      piiFound = true;
      addHits(hits, documentHits);
    }
    if (decision.maskFields) out = maskFields(out, decision.maskFields);
    if (topical.maskFields) out = maskFields(out, topical.maskFields);

    this.taint.observe(name, labels, piiFound);
    if (labels.includes("sensitive") || piiFound) this.fingerprints.add(name, [result.content, result.structuredContent ?? null]);
    else if (this.config.taint.basis === "data") this.fingerprints.addOrdinary([result.content, result.structuredContent ?? null]);
    // Upstreams with per-user auth: who the upstream saw, next to `user` (who called the gateway)
    const upstreamIdentity = currentCaller()?.upstreamIdentity;
    this.log({ ...base, type: "tool_response", output: out.content, ...(piiFound ? { piiHits: hits } : {}), ...(upstreamIdentity ? { upstreamIdentity } : {}) });
    if (piiFound) activeCallSpan()?.setAttribute("guardbee.pii_hits", Object.values(hits).reduce((sum, n) => sum + n, 0));

    void recordEvent({
      server: "security-proxy",
      tool: name,
      params: args,
      success: !result.isError,
      durationMs: Date.now() - started,
    });

    return out;
  }

  /** Lets the server ask for completions while this call runs, when interceptors.sampling is on. */
  private samplingFor(upstream: Upstream, tool: string, deferred?: DeferredApprovals): CallOptions {
    if (!this.interceptors.sampling?.enabled) return {};
    let asked = 0;
    // The server's request arrives on its own transport: tie it back to this call's span
    const span = activeCallSpan();
    const handler = (params: CreateMessageRequest["params"]) =>
      span ? withCallSpan(span, () => this.sample(upstream, tool, params, ++asked, deferred)) : this.sample(upstream, tool, params, ++asked, deferred);
    return { sampling: { owner: this, handler } };
  }

  /**
   * A server asking the agent's model for a completion. What it sends is
   * untrusted text aimed at the model; what the model answers goes to the
   * server, so it is checked like an egress call.
   */
  private async sample(
    upstream: Upstream,
    tool: string,
    params: CreateMessageRequest["params"],
    nth: number,
    deferred?: DeferredApprovals,
  ): Promise<CreateMessageResult> {
    const config = this.interceptors.sampling;
    const source = `sampling:${upstream.name}`;
    const base = { tool: source, server: upstream.name, upstream: upstream.name };
    const refuse = (reason: string, ruleId: string): never => {
      this.log({ ...base, type: "blocked", ruleId, reason });
      this.anomaly?.observeBlocked(source);
      throw new ProtocolError(ProtocolErrorCode.InvalidRequest, `${PREFIX} Sampling refused: ${reason}`);
    };
    if (!config?.enabled) return refuse("interceptors.sampling is off", "sampling:off");
    if (!this.sampler?.available()) {
      return refuse("the agent's client does not support sampling, or speaks MCP 2026-07-28, where it cannot be asked in the middle of another server's call", "sampling:unavailable");
    }
    const maxPerCall = config.maxPerCall ?? 3;
    if (nth > maxPerCall) return refuse(`more than ${maxPerCall} sampling requests during one call of "${tool}"`, "sampling:per_call");

    // What the server puts in front of the model
    const scan = scanToolResult([params.systemPrompt ?? "", params.messages], config.action);
    if (scan.action === "block") return refuse(scan.reason, "sampling:injection");
    if (scan.action === "warn") this.log({ ...base, type: "warn", ruleId: "sampling:injection", reason: scan.reason });

    if (config.approval) {
      const outcome = this.approver
        ? await this.approver({
            tool: source,
            upstream: upstream.name,
            args: { systemPrompt: params.systemPrompt ?? null, messages: params.messages },
            reason: `"${upstream.name}" asks your model for a completion during "${tool}"`,
            phase: "sampling",
            ...(this.sessionId ? { sessionId: this.sessionId } : {}),
            ...(deferred ? { deferred } : {}),
          })
        : "unavailable";
      this.log({ ...base, type: "approval", reason: `${outcome}: sampling during "${tool}"` });
      if (outcome !== "approved") return refuse(`not approved (${outcome})`, "sampling:approval");
    }

    // No conversation context for the server, and a bounded completion
    if (params.includeContext && params.includeContext !== "none") {
      this.log({ ...base, type: "warn", ruleId: "sampling:context", reason: `includeContext "${params.includeContext}" reduced to "none": a server gets no conversation context` });
    }
    const request = { ...params, includeContext: "none" as const, maxTokens: Math.min(params.maxTokens, config.maxTokens ?? 1024) };
    this.log({ ...base, type: "tool_call", reason: `sampling during "${tool}" (${nth}/${maxPerCall})`, input: { systemPrompt: request.systemPrompt ?? null, messages: request.messages } });
    const result = await this.sampler.create(request);

    // The answer goes to the server: no credentials, no data this session saw
    const credentials = this.credentialsIn(result.content);
    const carried = this.fingerprints.find(this.vault.detokenize(result.content));
    const leak = credentials.length > 0
      ? `the model's answer holds a credential (${credentials.join(", ")})`
      : carried
        ? `the model's answer carries data from "${carried.source}"`
        : null;
    if (leak && config.action === "block") return refuse(`${leak}; it would go to "${upstream.name}"`, "sampling:egress");
    if (leak) this.log({ ...base, type: "warn", ruleId: "sampling:egress", reason: leak });

    const masked = await this.protect(result.content, true, { upstream: upstream.name, tool: `sampling:${upstream.name}` });
    this.log({ ...base, type: "tool_response", output: masked.value, ...(masked.piiFound ? { piiHits: masked.hits } : {}) });
    return { ...result, content: masked.value };
  }

  async listResources(): Promise<Resource[]> {
    return callerStorage.run(this.callerScope(), () => this.listResourcesAs());
  }

  private async listResourcesAs(): Promise<Resource[]> {
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
  async readResource(uri: string, options: { deferred?: DeferredApprovals } = {}): Promise<ReadResourceResult> {
    return callerStorage.run(this.callerScope(), () => this.readResourceAs(uri, options));
  }

  private async readResourceAs(uri: string, options: { deferred?: DeferredApprovals } = {}): Promise<ReadResourceResult> {
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
      let scan = scanToolResult(texts, this.resultAction);
      let classified: AuditEvent["classifier"];
      const classifier = scan.action !== "block" ? classifierFor(this.config.classifier, "resources") : undefined;
      if (classifier) {
        const c = await classifyInjection(this.config.classifier!, classifier, texts, scan, this.resultAction);
        classified = c.audit;
        scan = c.scan;
      }
      const extra = classified ? { classifier: classified } : {};
      if (scan.action === "block") {
        this.log({ type: "blocked", tool: source, upstream: upstream.name, reason: scan.reason, ...extra });
        throw new Error(`${PREFIX} Resource blocked: ${scan.reason}`);
      }
      if (scan.action === "warn") this.log({ type: "warn", tool: source, upstream: upstream.name, reason: scan.reason, ...extra });
    }

    const topical = await this.topicsAfter(source, upstream, texts, ["untrusted"], {}, undefined, options.deferred);
    if (topical.withheld) throw new Error(`${PREFIX} Resource withheld: ${topical.withheld}`);

    let piiFound = false;
    const hits: PiiHits = {};
    let items = result.contents;
    if (this.interceptors.documents?.enabled) {
      const scanned = await this.scanDocuments(items.map((item) => ({ type: "resource", ...item })), { tool: source, upstream: upstream.name });
      if (Object.keys(scanned.hits).length > 0) {
        piiFound = true;
        addHits(hits, scanned.hits);
      }
      // A withheld blob comes back as a text notice under the same uri
      items = scanned.content.map((item, index) => {
        const original = result.contents[index]!;
        return item.type === "resource" ? original : { uri: original.uri, mimeType: "text/plain", text: (item as unknown as { text: string }).text };
      });
    }
    const contents: typeof items = [];
    for (const item of items) {
      if (!("text" in item) || typeof item.text !== "string") {
        contents.push(item);
        continue;
      }
      const text = await this.protect(item.text, topical.force, { upstream: upstream.name, tool: source });
      piiFound ||= text.piiFound;
      addHits(hits, text.hits);
      contents.push({ ...item, text: text.value });
    }

    this.taint.observe(source, ["untrusted"], piiFound);
    if (piiFound) this.fingerprints.add(source, result.contents);
    else if (this.config.taint.basis === "data") this.fingerprints.addOrdinary(result.contents);
    this.log({ type: "resource_read", tool: source, upstream: upstream.name, ...(piiFound ? { piiHits: hits } : {}) });
    return { ...result, contents };
  }

  async listPrompts(): Promise<Prompt[]> {
    return callerStorage.run(this.callerScope(), () => this.listPromptsAs());
  }

  private async listPromptsAs(): Promise<Prompt[]> {
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
  async getPrompt(name: string, args?: Record<string, string>, options: { deferred?: DeferredApprovals } = {}): Promise<GetPromptResult> {
    return callerStorage.run(this.callerScope(), () => this.getPromptAs(name, args, options));
  }

  private async getPromptAs(name: string, args?: Record<string, string>, options: { deferred?: DeferredApprovals } = {}): Promise<GetPromptResult> {
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
    const topical = await this.topicsAfter(source, route.upstream, result.messages, [], args ?? {}, undefined, options.deferred);
    if (topical.withheld) throw new Error(`${PREFIX} Prompt withheld: ${topical.withheld}`);
    return { ...result, messages: (await this.protect(result.messages, topical.force, { upstream: route.upstream.name, tool: source })).value };
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
