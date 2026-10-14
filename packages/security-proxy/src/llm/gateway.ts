import type http from "http";
import { createHash, timingSafeEqual } from "crypto";
import { PERSONAL_DATA_CATEGORIES, PII_PATTERNS, detectTopics, maskPiiInText, scanForPromptInjection } from "@guardbee/guard-core";
import type { AuditLogger } from "../audit/logger.js";
import type { Authenticate } from "../auth.js";
import type { GatewayConfig } from "../gateway/config.js";
import { evaluateTopicRules, globToRegExp } from "../gateway/policy.js";
import { PiiVault } from "../gateway/tokens.js";
import type { AuditEvent } from "../types.js";
import { BudgetStore, costOf, type LlmCaller, type LlmUsage } from "./budget.js";
import type { LlmApi, LlmConfig, LlmProvider } from "./config.js";
import { SseRelay, errorBody, mapCompletion, mapPrompt, promptTexts, usageOf } from "./shapes.js";
import { SseRewriter, type TextRewrite } from "./stream.js";

type Json = Record<string, unknown>;

const MAX_BODY_BYTES = 32 * 1024 * 1024;
const PERSONAL_DATA = new Set<string>(PERSONAL_DATA_CATEGORIES);
const PLACEHOLDER = new Map(PII_PATTERNS.map((p) => [p.name, p.replacement]));
/** Text from these roles is scanned for injection; the app's own system prompt and the model's turns are not. */
const UNTRUSTED_ROLES = new Set(["user", "tool", "function"]);
const ALL_ROLES = new Set(["system", "developer", "user", "assistant", "tool", "function"]);
/** Client headers passed on to the provider; everything else (cookies, the client's key) stays here. */
const FORWARDED_HEADERS = ["anthropic-version", "anthropic-beta", "openai-organization", "openai-project"];

export interface LlmGatewayOptions {
  llm: LlmConfig;
  /** Read per request: a dashboard policy update replaces config.interceptors. */
  config: GatewayConfig;
  audit: AuditLogger;
  /**
   * listen.apiKeys / listen.oidc, tried when the key is not a virtual key.
   * null: only virtual keys are accepted (never fall back to an open loopback listener).
   */
  authenticate: Authenticate | null;
  fetchImpl?: typeof fetch;
  budgets?: BudgetStore;
  /** Adds directory (LDAP) groups to a gateway key's user. */
  groupsFor?: (user: string | undefined, groups: string[]) => Promise<string[]>;
}

export type LlmHandler = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<boolean>;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

const digest = (value: string) => createHash("sha256").update(value).digest();

function readBody(req: http.IncomingMessage): Promise<Json> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, "request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
        resolve(parsed as Json);
      } catch {
        reject(new HttpError(400, "request body is not a JSON object"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

/** The client's key: `Authorization: Bearer` (OpenAI SDKs) or `x-api-key` (Anthropic SDKs). */
function presentedKey(req: http.IncomingMessage): string | null {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "")?.[1]?.trim();
  if (bearer) return bearer;
  const header = req.headers["x-api-key"];
  const key = Array.isArray(header) ? header[0] : header;
  return key?.trim() || null;
}

/**
 * OpenAI- and Anthropic-compatible endpoints in front of the real providers.
 * People and apps get a gateway key; the provider keys stay in the proxy.
 * Every prompt gets the same checks as a tool call — injection, credentials
 * on their way out, PII masking or tokens — and every call is counted
 * against the budgets and written to the audit log with its token usage.
 */
export function createLlmHandler(options: LlmGatewayOptions): LlmHandler {
  const { llm, audit, authenticate } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const budgets = options.budgets ?? new BudgetStore();
  const virtualKeys = llm.keys.map((entry) => ({ ...entry, hash: digest(entry.key) }));

  const identify = async (req: http.IncomingMessage): Promise<Omit<LlmCaller, "model">> => {
    const key = presentedKey(req);
    if (!key) {
      // An open loopback listener with no virtual keys needs no key at all
      const identity = authenticate && virtualKeys.length === 0 ? await authenticate(undefined) : null;
      if (identity) return { ...(identity.user ? { user: identity.user } : {}), groups: identity.groups, anonymousId: "anonymous" };
      throw new HttpError(401, "Missing API key");
    }
    const hash = digest(key);
    // Compare against every key, so the time taken does not say which one was close
    let found: (typeof virtualKeys)[number] | undefined;
    for (const entry of virtualKeys) if (timingSafeEqual(entry.hash, hash)) found = entry;
    const anonymousId = hash.toString("hex").slice(0, 16);
    if (found) return { user: found.user, groups: options.groupsFor ? await options.groupsFor(found.user, found.groups) : found.groups, anonymousId };
    const identity = authenticate ? await authenticate(`Bearer ${key}`) : null;
    if (!identity) throw new HttpError(401, "Invalid API key");
    return { ...(identity.user ? { user: identity.user } : {}), groups: identity.groups, anonymousId };
  };

  const routeOf = (api: LlmApi, model: string): LlmProvider | null => {
    for (const r of llm.routes) {
      const provider = llm.providers[r.provider];
      if (provider && provider.api === api && globToRegExp(r.model).test(model)) return provider;
    }
    return null;
  };
  const route = (api: LlmApi, model: string): LlmProvider => {
    const provider = routeOf(api, model);
    if (!provider) throw new HttpError(404, `model "${model}" is not served by this gateway`);
    return provider;
  };

  /** Every access entry that matches the caller adds its globs; none matching → accessDefault. */
  const mayUse = (caller: Omit<LlmCaller, "model">, model: string): boolean => {
    const entries = llm.access.filter(
      (rule) =>
        (rule.user === undefined || (caller.user !== undefined && globToRegExp(rule.user).test(caller.user))) &&
        (rule.group === undefined || caller.groups.includes(rule.group)),
    );
    if (entries.length === 0) return llm.accessDefault === "allow";
    return entries.some((rule) => rule.allow.some((glob) => globToRegExp(glob).test(model)));
  };

  const log = (event: Omit<AuditEvent, "ts">) => audit.log({ ts: new Date().toISOString(), ...event });

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse, api: LlmApi): Promise<void> => {
    const caller = await identify(req);
    let body = await readBody(req);
    const requested = body["model"];
    if (typeof requested !== "string" || requested === "") throw new HttpError(400, "model is required");
    let model = requested;
    let provider = route(api, model);
    const interceptors = options.config.interceptors;
    let base = {
      tool: `llm:${model}`,
      upstream: provider.name,
      labels: ["llm"],
      ...(caller.user ? { user: caller.user } : {}),
    };
    const refuse = (status: number, reason: string, ruleId: string, headers: Record<string, string> = {}): never => {
      log({ ...base, type: "blocked", ruleId, reason });
      throw new HttpError(status, `[GuardBee] ${reason}`, headers);
    };

    // 0. Model access: which models this caller may ask for
    if (!mayUse(caller, model)) {
      refuse(403, `model "${model}" is not allowed for ${caller.user ? `user "${caller.user}"` : "this key"} (llm.access)`, "llm:access");
    }

    // 1. Prompt injection in what people and tools wrote
    if (interceptors.promptInjection?.enabled !== false) {
      const scan = scanForPromptInjection(promptTexts(api, body, UNTRUSTED_ROLES), interceptors.promptInjection?.action ?? "block");
      if (scan.action === "block") refuse(403, scan.reason, "llm:injection");
      if (scan.action === "warn") log({ ...base, type: "warn", ruleId: "llm:injection", reason: scan.reason });
    }

    // 2. Credentials on their way to the provider
    const egress = interceptors.egressSecrets;
    if (egress?.enabled !== false) {
      const kinds = new Set<string>();
      mapPrompt(api, body, (text) => (maskPiiInText(text, (name, match) => (PERSONAL_DATA.has(name) ? match : (kinds.add(name), match))), text));
      if (kinds.size > 0) {
        const reason = `credential in the prompt for ${model} (${[...kinds].join(", ")})`;
        if ((egress?.action ?? interceptors.promptInjection?.action ?? "block") === "block") refuse(403, reason, "llm:credential");
        log({ ...base, type: "warn", ruleId: "llm:credential", reason });
      }
    }

    // 2b. Topic rules (match.topic, tool: llm:<model>) on everything sent to the provider
    let forceMask = false;
    const topics = options.config.topics ?? [];
    if (topics.length > 0 && options.config.rules.some((rule) => rule.match.topic !== undefined)) {
      const found = detectTopics(promptTexts(api, body, ALL_ROLES), topics).map((hit) => hit.id);
      const decision = evaluateTopicRules(options.config.rules, {
        tool: base.tool,
        upstream: provider.name,
        labels: [],
        tainted: false,
        topics: found,
        ...(caller.user ? { user: caller.user } : {}),
        groups: caller.groups,
      });
      if (decision) {
        const reason = `the prompt is about ${found.join(", ")} (policy rule ${decision.ruleId})`;
        if (decision.action === "deny") refuse(403, reason, decision.ruleId!);
        // No one to ask in the middle of an API call: an approval rule refuses
        if (decision.action === "approve") refuse(403, `${reason}; it needs approval, which API calls cannot ask for`, decision.ruleId!);
        if (decision.action === "warn") log({ ...base, type: "warn", ruleId: decision.ruleId, reason });
        if (decision.action === "mask") forceMask = true;
      }
    }

    // 2c. Sensitive data goes to your own model instead of the one asked for
    const include = interceptors.piiMasking?.include?.length ? new Set(interceptors.piiMasking.include) : undefined;
    let routedFrom: string | undefined;
    const sensitive = llm.sensitive;
    if (sensitive && model !== sensitive.model) {
      const why: string[] = [];
      if (sensitive.on.pii) {
        const found = new Set<string>();
        mapPrompt(api, body, (text) => (maskPiiInText(text, (name, match) => (PERSONAL_DATA.has(name) && found.add(name), match), include), text));
        why.push(...[...found].filter((category) => !sensitive.on.categories || sensitive.on.categories.includes(category)));
      }
      if (sensitive.on.topics) {
        const wanted = topics.filter((topic) => sensitive.on.topics!.includes(topic.id));
        why.push(...detectTopics(promptTexts(api, body, ALL_ROLES), wanted).map((hit) => `topic ${hit.id}`));
      }
      if (why.length > 0) {
        const target = routeOf(api, sensitive.model);
        // Fail closed: sensitive data is never sent on to the model it was meant to avoid
        if (!target) refuse(403, `the prompt holds ${why.join(", ")}, and "${sensitive.model}" has no ${api} route (llm.sensitive)`, "llm:route:sensitive");
        routedFrom = model;
        model = sensitive.model;
        provider = target!;
        body = { ...body, model };
        base = { ...base, tool: `llm:${model}`, upstream: provider.name };
        log({ ...base, type: "warn", ruleId: "llm:route:sensitive", reason: `routed from ${routedFrom} to ${model}: the prompt holds ${why.join(", ")}` });
      }
    }

    // 3. Budgets: only a request that is about to go out counts
    const over = budgets.admit(llm.budgets, { ...caller, model });
    if (over) refuse(429, over.reason, over.ruleId, { "retry-after": String(over.retryAfter) });

    // 4. PII: counted always, masked (or tokenized) unless turned off
    const vault = new PiiVault();
    const hits: Record<string, number> = {};
    const tokenize = interceptors.piiMasking?.mode === "tokenize";
    // Routed in-house: the data stays inside, unless llm.sensitive.mask keeps masking on
    const masking = forceMask || (interceptors.piiMasking?.enabled !== false && !(routedFrom && !sensitive?.mask));
    let forward = mapPrompt(api, body, (text) => {
      const redacted = maskPiiInText(text, (name) => {
        const category = PERSONAL_DATA.has(name) ? name : "secret";
        hits[category] = (hits[category] ?? 0) + 1;
        return PLACEHOLDER.get(name) ?? "[REDACTED]";
      }, include);
      if (!masking || redacted === text) return text;
      return tokenize ? vault.tokenize(text, include) : redacted;
    });
    const piiHits = Object.keys(hits).length > 0 ? { piiHits: hits } : {};
    log({ ...base, type: "tool_call", input: forward, ...piiHits, ...(routedFrom ? { llm: { model, routedFrom } } : {}) });

    // 5. To the provider. The answer is rewritten when tokens must go back or
    //    responses are masked — a stream too, as it passes (llm/stream.ts).
    const wantsStream = forward["stream"] === true;
    const rewrite = vault.size > 0 || llm.maskResponses;
    const rewriteText: TextRewrite = (text) => {
      const hits: Record<string, number> = {};
      const restored = vault.detokenize(text);
      if (!llm.maskResponses) return { text: restored, hits };
      const masked = maskPiiInText(
        restored,
        (name) => {
          const category = PERSONAL_DATA.has(name) ? name : "secret";
          hits[category] = (hits[category] ?? 0) + 1;
          return PLACEHOLDER.get(name) ?? "[REDACTED]";
        },
        include,
      );
      return { text: masked, hits };
    };
    const clientUsage = typeof forward["stream_options"] === "object" && (forward["stream_options"] as Json | null)?.["include_usage"] === true;
    if (wantsStream && api === "openai") {
      forward = { ...forward, stream_options: { ...((forward["stream_options"] as Json | undefined) ?? {}), include_usage: true } };
    }

    const headers: Record<string, string> = { "content-type": "application/json", ...provider.headers };
    if (provider.api === "anthropic") {
      headers["x-api-key"] = provider.apiKey;
      headers["anthropic-version"] ??= "2023-06-01";
    } else {
      headers["authorization"] = `Bearer ${provider.apiKey}`;
    }
    for (const name of FORWARDED_HEADERS) {
      const value = req.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    const endpoint = api === "anthropic" ? "/v1/messages" : "/chat/completions";
    const upstreamUrl = api === "anthropic" ? provider.baseUrl.replace(/\/v1$/, "") + endpoint : provider.baseUrl + endpoint;

    let upstream: Response;
    try {
      upstream = await fetchImpl(upstreamUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(forward),
        signal: AbortSignal.timeout(llm.timeoutSeconds * 1000),
      });
    } catch (err) {
      const reason = `provider ${provider.name} unreachable: ${err instanceof Error ? err.message : String(err)}`;
      log({ ...base, type: "warn", reason });
      throw new HttpError(502, reason);
    }

    const finish = (usage: LlmUsage | null, extra: Partial<AuditEvent> = {}) => {
      const cost = usage ? costOf(llm.pricing, model, usage) : null;
      if (usage) budgets.record(llm.budgets, { ...caller, model }, usage, cost);
      log({
        ...base,
        type: "tool_response",
        ...(usage || routedFrom
          ? {
              llm: {
                model,
                ...(routedFrom ? { routedFrom } : {}),
                ...(usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : {}),
                ...(usage && cost !== null ? { costUsd: cost } : {}),
              },
            }
          : {}),
        ...extra,
      });
    };

    if (!upstream.ok) {
      // The provider's own error, unchanged: the client's SDK knows how to read it
      const text = await upstream.text();
      log({ ...base, type: "warn", reason: `provider ${provider.name} answered ${upstream.status}` });
      res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
      res.end(text);
      return;
    }

    if (wantsStream) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const dropUsage = api === "openai" && !clientUsage;
      const relay = rewrite ? new SseRewriter(api, rewriteText, dropUsage) : new SseRelay(api, dropUsage);
      if (upstream.body) {
        const reader = upstream.body.getReader();
        // The client went away: stop reading so the provider stops generating
        res.on("close", () => void reader.cancel().catch(() => {}));
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const out = relay.push(value);
          if (out) res.write(out);
        }
      }
      const rest = relay.end();
      res.end(rest);
      const streamHits = relay instanceof SseRewriter ? relay.hits : {};
      finish(relay.usage, Object.keys(streamHits).length > 0 ? { piiHits: streamHits } : {});
      return;
    }

    let completion = (await upstream.json()) as Json;
    const answerHits: Record<string, number> = {};
    completion = mapCompletion(api, completion, (text) => {
      const out = rewriteText(text);
      for (const [category, count] of Object.entries(out.hits)) answerHits[category] = (answerHits[category] ?? 0) + count;
      return out.text;
    });
    finish(usageOf(api, completion), Object.keys(answerHits).length > 0 ? { piiHits: answerHits } : {});
    sendJson(res, 200, completion);
  };

  const listModels = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const caller = await identify(req);
    const literal = llm.routes.filter((r) => !/[*?]/.test(r.model) && mayUse(caller, r.model));
    sendJson(res, 200, { object: "list", data: literal.map((r) => ({ id: r.model, object: "model", created: 0, owned_by: r.provider })) });
  };

  return async (req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const api: LlmApi | null =
      req.method === "POST" && path === `${llm.path}/chat/completions` ? "openai" : req.method === "POST" && path === `${llm.path}/messages` ? "anthropic" : null;
    const models = req.method === "GET" && path === `${llm.path}/models`;
    if (!api && !models) return false;
    try {
      if (models) await listModels(req, res);
      else await handle(req, res, api!);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : typeof (err as { status?: unknown }).status === "number" ? (err as { status: number }).status : 500;
      const message = err instanceof Error ? err.message : "Internal error";
      if (!res.headersSent) sendJson(res, status, errorBody(api ?? "openai", status, message), err instanceof HttpError ? err.headers : {});
      else res.end();
    }
    return true;
  };
}
