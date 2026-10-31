import type http from "http";
import { createHash, timingSafeEqual } from "crypto";
import {
  MODEL_PII,
  MODEL_PII_REPLACEMENT,
  SPECIAL_CATEGORIES,
  SPECIAL_CATEGORY_REPLACEMENT,
  PERSONAL_DATA_CATEGORIES,
  PII_PATTERNS,
  PiiPatternTimeoutError,
  detectTopics,
  maskPiiInText,
  orgPatternShape,
  scanForPromptInjection,
  type OrgPatternEvent,
  type ModelSpan,
  type SpanLookup,
} from "@guardbee/guard-core";
import { z } from "zod";
import type { AuditLogger } from "../audit/logger.js";
import type { Authenticate } from "../auth.js";
import type { GatewayConfig } from "../gateway/config.js";
import { evaluateTopicRules, globToRegExp } from "../gateway/policy.js";
import { NerError, nerDetectorFor, scanNames } from "../gateway/ner.js";
import { orgPatternsFor, piiScopesFor } from "../gateway/pii-scope.js";
import { PiiVault } from "../gateway/tokens.js";
import type { AuditEvent } from "../types.js";
import { BudgetStore, costOf, type LlmCaller, type LlmUsage } from "./budget.js";
import { DEFAULT_MAX_TEXT_CHARS, MAX_BODY_BYTES, type LlmApi, type LlmConfig, type LlmAudio, type LlmDocuments, type LlmProvider } from "./config.js";
import { SseRelay, apiOf, errorBody, mapCompletion, mapPrompt, promptTexts, unmaskableParts, usageOf, type LlmShape } from "./shapes.js";
import { SseRewriter, type RewritePrepare, type TextRewrite } from "./stream.js";
import { base64Bytes, mapDocuments, textPart, type DocumentModality, type InlineDocument } from "./documents.js";

type Json = Record<string, unknown>;

/** `guardbee` in a request body: the request's own block patterns (allow patterns are refused later, by name). */
const requestPatternsSchema = z.object(orgPatternShape).strict();
const PERSONAL_DATA = new Set<string>([...PERSONAL_DATA_CATEGORIES, ...MODEL_PII, ...SPECIAL_CATEGORIES]);
const PLACEHOLDER = new Map<string, string>([...PII_PATTERNS.map((p) => [p.name, p.replacement] as const), ...Object.entries(MODEL_PII_REPLACEMENT), ...Object.entries(SPECIAL_CATEGORY_REPLACEMENT)]);
/** Text from these roles is scanned for injection; the app's own system prompt and the model's turns are not. */
const UNTRUSTED_ROLES = new Set(["user", "tool", "function"]);
const ALL_ROLES = new Set(["system", "developer", "user", "assistant", "tool", "function"]);
/** Client headers passed on to the provider; everything else (cookies, the client's key) stays here. */
const FORWARDED_HEADERS = ["anthropic-version", "anthropic-beta", "openai-organization", "openai-project"];
/** Endpoints under llm.path, and the body each takes. */
const CLIENT_PATHS: Partial<Record<string, LlmShape>> = { "/chat/completions": "openai", "/messages": "anthropic", "/responses": "responses", "/embeddings": "embeddings" };
/** The provider path of each endpoint: after baseUrl, or for Anthropic after its host. */
const ENDPOINTS: Record<LlmShape, string> = { openai: "/chat/completions", anthropic: "/v1/messages", responses: "/responses", embeddings: "/embeddings" };

/**
 * The fail-closed contract: when the proxy cannot check or mask a request,
 * the provider is never called. These codes are stable — clients may branch
 * on them — and come back in the error body (`error.code`) and in the
 * `x-guardbee-error` header.
 */
export const FAIL_CLOSED = {
  /** 502: a detector threw or a block pattern ran over its time budget. */
  maskingFailed: "guardbee_masking_failed",
  /** 415: audio, a file, a PDF or a content shape the proxy cannot read. */
  unmaskable: "guardbee_unmaskable_content",
  /** 413: one text is longer than llm.maxTextChars. */
  textTooLarge: "guardbee_text_too_large",
} as const;

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
    readonly code?: string,
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

interface ReadDocument {
  modality: DocumentModality;
  label: string;
  bytes: number;
  sha256: string;
  pages: number;
  /** The whole text, when every page was read. */
  text?: string;
  /** Why it was not read in full. */
  unread?: string;
}

const IMAGE_KINDS = new Set(["png", "jpeg", "gif", "webp", "bmp", "tiff"]);

/** The modalities llm.documents reads. */
function documentModalities(config: LlmDocuments | undefined): Set<DocumentModality> {
  const out = new Set<DocumentModality>();
  if (config?.pdf) out.add("pdf");
  if (config?.images) out.add("image");
  if (config?.audio) out.add("audio");
  return out;
}

/** `PDF "report.pdf"`, `image "image 2"`, `audio "audio 3"`: how a document is named in reasons and warnings. */
const describeDocument = (doc: Pick<ReadDocument, "modality" | "label">) => `${doc.modality === "pdf" ? "PDF" : doc.modality} "${doc.label}"`;

/** The audio formats OpenAI's `input_audio` takes, checked by their bytes. */
function isAudio(format: string | undefined, data: Buffer): boolean {
  if (format === "wav") return data.toString("latin1", 0, 4) === "RIFF" && data.toString("latin1", 8, 12) === "WAVE";
  if (format === "mp3") return data.toString("latin1", 0, 3) === "ID3" || (data[0] === 0xff && ((data[1] ?? 0) & 0xe0) === 0xe0);
  return false;
}

/** Speech to text with the configured OpenAI-compatible transcription endpoint. */
async function transcribe(audio: LlmAudio, data: Buffer, format: string, signal: AbortSignal): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(data)], { type: format === "wav" ? "audio/wav" : "audio/mpeg" }), `audio.${format}`);
  form.append("model", audio.model);
  form.append("response_format", "json");
  if (audio.language) form.append("language", audio.language);
  let res: Response;
  try {
    res = await fetch(audio.url, { method: "POST", body: form, headers: audio.apiKey ? { authorization: `Bearer ${audio.apiKey}` } : {}, signal });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new Error("the transcription service could not be reached (llm.documents.audio)");
  }
  // The answer's body may quote the audio: only the status is reported
  if (!res.ok) throw new Error(`the transcription service answered HTTP ${res.status} (llm.documents.audio)`);
  const text = ((await res.json().catch(() => ({}))) as { text?: unknown }).text;
  if (typeof text !== "string") throw new Error("the transcription service sent no text (llm.documents.audio)");
  return text;
}

/**
 * The inline PDFs, images and audio of a request, in mapDocuments order:
 * PDFs and images read with the document scanner, audio transcribed by
 * llm.documents.audio. Anything short of all the text — too large, not what
 * it claims to be, encrypted, over maxPages, a page without a text layer and
 * no OCR, OCR not installed, the transcription service failing, the time
 * limit — leaves `text` unset: the document was not checked.
 */
async function readDocuments(shape: LlmShape, body: Json, config: LlmDocuments, modalities: ReadonlySet<DocumentModality>): Promise<ReadDocument[]> {
  const found: InlineDocument[] = [];
  mapDocuments(shape, body, (doc) => (found.push(doc), undefined), modalities);
  if (found.length === 0) return [];
  const out: ReadDocument[] = [];
  for (const doc of found) {
    const bytes = base64Bytes(doc.data);
    if (bytes > config.maxBytes) {
      out.push({ modality: doc.modality, label: doc.label, bytes, sha256: "", pages: 0, unread: `${bytes} bytes, over llm.documents.maxBytes (${config.maxBytes})` });
      continue;
    }
    const data = Buffer.from(doc.data, "base64");
    const read: ReadDocument = { modality: doc.modality, label: doc.label, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex"), pages: 0 };
    out.push(read);
    if (doc.modality === "audio") {
      if (!isAudio(doc.format, data)) {
        read.unread = doc.format === "wav" || doc.format === "mp3" ? `the data is not ${doc.format} audio` : `audio format "${doc.format}" is not read (wav, mp3)`;
        continue;
      }
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), config.timeoutSeconds * 1000);
      timer.unref();
      try {
        read.text = await transcribe(config.audio!, data, doc.format!, abort.signal);
        read.pages = 1;
      } catch (err) {
        read.unread = abort.signal.aborted
          ? `reading took over ${config.timeoutSeconds} s (llm.documents.timeoutSeconds)`
          : err instanceof Error && err.message.includes("llm.documents") ? err.message : `could not be read (${err instanceof Error ? err.name : typeof err})`;
      } finally {
        clearTimeout(timer);
      }
      continue;
    }
    const { detectKind, extractText } = await import("@guardbee/mcp-document-scanner");
    const kind = detectKind(data.subarray(0, 16));
    if (doc.modality === "pdf" ? kind !== "pdf" : !IMAGE_KINDS.has(kind)) {
      read.unread = doc.modality === "pdf" ? "the data is not a PDF" : "the data is not an image";
      continue;
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      const extraction = await Promise.race([
        extractText(new Uint8Array(data), {
          // An image is only read with OCR; `ocr` is about PDF pages without a text layer
          ocr: doc.modality === "image" || config.ocr,
          maxBytes: config.maxBytes,
          maxPages: config.maxPages,
          languages: config.languages,
          ...(config.langPath ? { langPath: config.langPath } : {}),
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`reading took over ${config.timeoutSeconds} s (llm.documents.timeoutSeconds)`)), config.timeoutSeconds * 1000);
          timer.unref();
        }),
      ]);
      read.pages = extraction.pages.length;
      if (extraction.notes.length > 0) read.unread = extraction.notes.join("; ");
      else read.text = extraction.pages.map((page) => page.text).join("\n\n");
    } catch (err) {
      // pdf.js and Tesseract errors name the problem (PasswordException, InvalidPDFException) without quoting content
      read.unread = err instanceof Error && err.message.includes("llm.documents") ? err.message : `could not be read (${err instanceof Error ? err.name : typeof err})`;
    } finally {
      clearTimeout(timer);
    }
  }
  return out;
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

  const routeOf = (api: LlmApi, model: string): { provider: LlmProvider; glob: string; maskingOff: boolean } | null => {
    for (const r of llm.routes) {
      const provider = llm.providers[r.provider];
      if (provider && provider.api === api && globToRegExp(r.model).test(model)) return { provider, glob: r.model, maskingOff: r.masking === "off" };
    }
    return null;
  };
  const route = (api: LlmApi, model: string) => {
    const found = routeOf(api, model);
    if (!found) throw new HttpError(404, `model "${model}" is not served by this gateway`);
    return found;
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

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse, shape: LlmShape): Promise<void> => {
    const api = apiOf(shape);
    const caller = await identify(req);
    let body = await readBody(req);
    /** What the checks read: the body, with each readable PDF's text in its place (step 0b). */
    let checked: Json = body;
    const requested = body["model"];
    if (typeof requested !== "string" || requested === "") throw new HttpError(400, "model is required");
    let model = requested;
    let routed = route(api, model);
    let provider = routed.provider;
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
    const failClosed = (status: number, code: string, reason: string, ruleId: string): never => {
      log({ ...base, type: "blocked", ruleId, reason });
      throw new HttpError(status, `[GuardBee] ${reason}; the request was not sent`, { "x-guardbee-error": code }, code);
    };
    // Every check before the provider call runs inside this: a detector that throws
    // refuses the request (502) and the error's message — which may quote the
    // text — is neither logged nor returned.
    const inspect = <T>(fn: () => T): T => {
      try {
        return fn();
      } catch (err) {
        if (err instanceof HttpError) throw err;
        if (err instanceof PiiPatternTimeoutError) return failClosed(502, FAIL_CLOSED.maskingFailed, err.message, "pii:pattern-timeout");
        return failClosed(502, FAIL_CLOSED.maskingFailed, `masking failed (${err instanceof Error ? err.name : typeof err})`, "pii:masking-failed");
      }
    };

    // The request's own block patterns (`guardbee.blockPatterns`) add masking on top of
    // piiMasking's; they never reach the provider, and allow patterns are refused.
    let org = orgPatternsFor(interceptors.piiMasking);
    if (body["guardbee"] !== undefined) {
      const { guardbee: extra, ...rest } = body;
      body = rest;
      const parsed = requestPatternsSchema.safeParse(extra);
      if (!parsed.success) refuse(400, `guardbee: ${parsed.error!.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; ")}`, "llm:pii-patterns");
      try {
        org = org.withRequest(parsed.data!);
      } catch (err) {
        refuse(400, `guardbee: ${(err as Error).message}`, "llm:pii-patterns");
      }
    }
    const orgEvent = (event: OrgPatternEvent) =>
      log({
        ...base,
        type: "warn",
        ruleId: event.type === "allowed" ? "pii:allow" : "pii:allow-skipped",
        reason:
          event.type === "allowed"
            ? `allow pattern ${JSON.stringify(event.pattern)} kept a ${event.detector} value unmasked`
            : `allow pattern ${JSON.stringify(event.pattern)} ran over its time budget and was skipped`,
      });
    // Org categories get numbered placeholders shared by the whole request
    const numbers = new Map<string, Map<string, number>>();
    const numbered = (category: string, match: string) => {
      let seen = numbers.get(category);
      if (!seen) numbers.set(category, (seen = new Map()));
      if (!seen.has(match)) seen.set(match, seen.size + 1);
      return `<${category}_${seen.get(match)}>`;
    };

    // Person names (ner:): one model call over every prompt text, made the first time
    // routing or masking needs it. No answer, no request: a name no regex knows may be in it.
    let nameScan: Promise<SpanLookup> | undefined;
    const names = async (): Promise<SpanLookup | undefined> => {
      const ner = options.config.ner;
      if (!ner) return undefined;
      if (!nameScan) {
        const texts: string[] = [];
        mapPrompt(shape, checked, (text) => (texts.push(text), text));
        nameScan = scanNames(nerDetectorFor(ner), texts);
      }
      try {
        return await nameScan;
      } catch (err) {
        const reason = err instanceof NerError ? `name detection failed: ${err.message}` : `name detection failed (${err instanceof Error ? err.name : typeof err})`;
        return failClosed(502, FAIL_CLOSED.maskingFailed, reason, "pii:ner-failed");
      }
    };

    // 0. Model access: which models this caller may ask for
    if (!mayUse(caller, model)) {
      refuse(403, `model "${model}" is not allowed for ${caller.user ? `user "${caller.user}"` : "this key"} (llm.access)`, "llm:access");
    }

    // 0b. Inline PDFs, images and audio (llm.documents): their text takes their place in
    //     `checked`, which every check below reads; the provider still gets the
    //     file itself. One that cannot be read in full stays in place, and so
    //     stays unmaskable.
    const modalities = documentModalities(llm.documents);
    const documents = llm.documents && modalities.size > 0 && shape !== "embeddings" ? await readDocuments(shape, body, llm.documents, modalities) : [];
    const documentChecks = [
      ...(shape !== "embeddings" && interceptors.promptInjection?.enabled !== false ? ["injection"] : []),
      ...(interceptors.egressSecrets?.enabled !== false ? ["credentials"] : []),
      ...((options.config.topics ?? []).length > 0 && options.config.rules.some((rule) => rule.match.topic !== undefined) ? ["topics"] : []),
      ...(llm.sensitive ? ["sensitive-routing"] : []),
      "pii",
    ];
    for (const doc of documents) {
      if (doc.unread) log({ ...base, type: "warn", ruleId: "documents:unread", reason: `${describeDocument(doc)} not read: ${doc.unread}` });
    }
    checked = documents.length > 0 ? mapDocuments(shape, body, (_doc, i, part) => (documents[i]?.text !== undefined ? textPart(shape, documents[i]!.text!, part) : undefined), modalities) : body;

    // 1. Prompt injection in what people and tools wrote. Text sent for embedding is
    //    not run by a model, and a document about injection must still be indexable.
    if (shape !== "embeddings" && interceptors.promptInjection?.enabled !== false) {
      const scan = inspect(() => scanForPromptInjection(promptTexts(shape, checked, UNTRUSTED_ROLES), interceptors.promptInjection?.action ?? "block"));
      if (scan.action === "block") refuse(403, scan.reason, "llm:injection");
      if (scan.action === "warn") log({ ...base, type: "warn", ruleId: "llm:injection", reason: scan.reason });
    }

    // 2. Credentials on their way to the provider
    const egress = interceptors.egressSecrets;
    if (egress?.enabled !== false) {
      const kinds = new Set<string>();
      inspect(() => mapPrompt(shape, checked, (text) => (maskPiiInText(text, (name, match) => (PERSONAL_DATA.has(name) ? match : (kinds.add(name), match))), text)));
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
      const found = inspect(() => detectTopics(promptTexts(shape, checked, ALL_ROLES), topics).map((hit) => hit.id));
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
    const detect = piiScopesFor(interceptors.piiMasking, provider.name).detect;
    let routedFrom: string | undefined;
    const sensitive = llm.sensitive;
    // Not embeddings: vectors from another model are not comparable with the index's
    if (sensitive && model !== sensitive.model && shape !== "embeddings") {
      const why: string[] = [];
      if (sensitive.on.pii) {
        const found = new Set<string>();
        const spans = await names();
        inspect(() => mapPrompt(shape, checked, (text) => (maskPiiInText(text, (name, match) => (PERSONAL_DATA.has(name) && found.add(name), match), detect, undefined, spans), text)));
        why.push(...[...found].filter((category) => !sensitive.on.categories || sensitive.on.categories.includes(category)));
      }
      if (sensitive.on.topics) {
        const wanted = topics.filter((topic) => sensitive.on.topics!.includes(topic.id));
        why.push(...inspect(() => detectTopics(promptTexts(shape, checked, ALL_ROLES), wanted)).map((hit) => `topic ${hit.id}`));
      }
      if (why.length > 0) {
        const target = routeOf(api, sensitive.model);
        // Fail closed: sensitive data is never sent on to the model it was meant to avoid
        if (!target) refuse(403, `the prompt holds ${why.join(", ")}, and "${sensitive.model}" has no ${api} route (llm.sensitive)`, "llm:route:sensitive");
        routedFrom = model;
        model = sensitive.model;
        routed = target!;
        provider = routed.provider;
        body = { ...body, model };
        base = { ...base, tool: `llm:${model}`, upstream: provider.name };
        log({ ...base, type: "warn", ruleId: "llm:route:sensitive", reason: `routed from ${routedFrom} to ${model}: the prompt holds ${why.join(", ")}` });
      }
    }

    // 2d. What masking applies, settled before the budget counts the request.
    //     Routed in-house: the data stays inside, unless llm.sensitive.mask keeps masking on.
    //     A route with masking: off passes PII through — said so in the audit log, every time.
    const maskingOff = routed.maskingOff && !forceMask;
    const masking = forceMask || (interceptors.piiMasking?.enabled !== false && !maskingOff && !(routedFrom && !sensitive?.mask));
    if (maskingOff && interceptors.piiMasking?.enabled !== false) {
      log({ ...base, type: "warn", ruleId: "pii:masking-off", reason: `PII masking is off for route "${routed.glob}" (llm.routes)` });
    }
    if (masking) {
      // What the proxy cannot read, it cannot mask: refused, not forwarded
      const unreadable = [...documents.filter((doc) => doc.unread).map((doc) => `${describeDocument(doc)} (${doc.unread})`), ...unmaskableParts(shape, checked)];
      if (unreadable.length > 0) {
        failClosed(415, FAIL_CLOSED.unmaskable, `the request holds content the proxy cannot mask: ${unreadable.join(", ")}`, "pii:unmaskable");
      }
      const limit = llm.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
      let longest = 0;
      mapPrompt(shape, checked, (text) => ((longest = Math.max(longest, text.length)), text));
      if (longest > limit) {
        failClosed(413, FAIL_CLOSED.textTooLarge, `one text is ${longest} characters, over llm.maxTextChars (${limit}); split it into smaller messages or parts`, "pii:text-too-large");
      }
    }
    const spans = masking ? await names() : undefined;

    // 2e. PII in a PDF, image or audio is counted like any other; with masking on it refuses
    //     the request, since the proxy cannot rewrite the file and will not send it unmasked.
    const docHits: Record<string, number> = {};
    const readDocs = documents.filter((doc) => doc.text !== undefined);
    if (readDocs.length > 0) {
      const { detect, mask } = piiScopesFor(interceptors.piiMasking, provider.name);
      const maskable = new Set<string>();
      for (const doc of readDocs) {
        inspect(() =>
          org.withEvents(orgEvent, () =>
            maskPiiInText(doc.text!, (name, match) => {
              const custom = org.categories.has(name);
              const category = custom ? name : PERSONAL_DATA.has(name) ? name : "secret";
              docHits[category] = (docHits[category] ?? 0) + 1;
              if (custom || mask.has(name)) maskable.add(category);
              return match;
            }, detect, org, spans),
          ),
        );
      }
      if (masking && maskable.size > 0) {
        refuse(403, `${readDocs.map(describeDocument).join(", ")} holds ${[...maskable].join(", ")}; the proxy cannot mask inside a file, so the request was not sent`, "pii:document");
      }
    }

    // 3. Budgets: only a request that is about to go out counts
    const over = await budgets.admit(llm.budgets, { ...caller, model });
    if (over) refuse(429, over.reason, over.ruleId, { "retry-after": String(over.retryAfter) });

    // 4. PII: counted always, masked (or tokenized) unless turned off
    const vault = new PiiVault();
    // The provider's own selection: routing above may have changed it
    const scopes = piiScopesFor(interceptors.piiMasking, provider.name);
    const hits: Record<string, number> = {};
    // Embeddings: placeholders, never tokens, and org numbers counted per text,
    // so the same text always embeds the same way (indexes stay stable)
    const tokenize = shape !== "embeddings" && interceptors.piiMasking?.mode === "tokenize";
    let forward: Json = inspect(() =>
      mapPrompt(shape, body, (text) => {
        if (shape === "embeddings") numbers.clear();
        const redacted = org.withEvents(orgEvent, () =>
          maskPiiInText(text, (name, match) => {
            const custom = org.categories.has(name);
            const category = custom ? name : PERSONAL_DATA.has(name) ? name : "secret";
            hits[category] = (hits[category] ?? 0) + 1;
            if (custom) return numbered(name, match);
            return scopes.mask.has(name) ? (PLACEHOLDER.get(name) ?? "[REDACTED]") : match;
          }, scopes.detect, org, spans),
        );
        if (!masking || redacted === text) return text;
        return tokenize ? vault.tokenize(text, scopes.mask, org, spans) : redacted;
      }),
    );
    for (const [category, n] of Object.entries(docHits)) hits[category] = (hits[category] ?? 0) + n;
    const piiHits = Object.keys(hits).length > 0 ? { piiHits: hits } : {};
    // The log keeps a placeholder with each file's hash, never its bytes
    const logged = documents.length > 0 ? mapDocuments(shape, forward, (_doc, i, part) => textPart(shape, `[${documents[i]!.modality} "${documents[i]!.label}": ${documents[i]!.bytes} bytes, sha256 ${documents[i]!.sha256}]`, part), modalities) : forward;
    const documentsRead = readDocs.length > 0 ? { documents: readDocs.map((doc) => ({ name: doc.label, modality: doc.modality, bytes: doc.bytes, sha256: doc.sha256, pages: doc.pages, chars: doc.text!.length, checks: documentChecks })) } : {};
    log({ ...base, type: "tool_call", input: logged, ...piiHits, ...documentsRead, ...(routedFrom ? { llm: { model, routedFrom } } : {}) });

    // 5. To the provider. The answer is rewritten when tokens must go back or
    //    responses are masked — a stream too, as it passes (llm/stream.ts).
    const wantsStream = forward["stream"] === true;
    const maskResponses = llm.maskResponses && !maskingOff;
    const rewrite = vault.size > 0 || maskResponses;
    // Names in the answer (ner:): the model runs over each text before the rewrite sees it
    // (prepareAnswer). A failure withholds the answer's text from then on, logged once.
    const ner = maskResponses ? options.config.ner : undefined;
    const answerNames = new Map<string, readonly ModelSpan[]>();
    let answerNerFailed = false;
    const prepareAnswer: RewritePrepare | undefined = ner
      ? async (texts) => {
          if (answerNerFailed) return;
          const fresh = [...new Set(texts.map((text) => vault.detokenize(text)))].filter((text) => !answerNames.has(text));
          if (fresh.length === 0) return;
          try {
            const lookup = await scanNames(nerDetectorFor(ner), fresh);
            for (const text of fresh) answerNames.set(text, lookup(text));
          } catch (err) {
            answerNerFailed = true;
            const reason = err instanceof NerError ? `name detection in the answer failed: ${err.message}` : `name detection in the answer failed (${err instanceof Error ? err.name : typeof err})`;
            log({ ...base, type: "blocked", ruleId: "pii:ner-failed", reason });
          }
        }
      : undefined;
    const answerSpans: SpanLookup | undefined = ner
      ? (text) => {
          const spans = answerNames.get(text);
          if (spans) return spans;
          if (!/\p{L}/u.test(text)) return [];
          throw new NerError("an answer text reached masking without going through the NER model");
        }
      : undefined;
    const rewriteText: TextRewrite = (text) => {
      const hits: Record<string, number> = {};
      const restored = vault.detokenize(text);
      if (!maskResponses) return { text: restored, hits };
      if (answerNerFailed) return { text: "[GuardBee: withheld, name detection failed]", hits: {} };
      try {
        const masked = org.withEvents(orgEvent, () =>
          maskPiiInText(
            restored,
            (name, match) => {
              const custom = org.categories.has(name);
              const category = custom ? name : PERSONAL_DATA.has(name) ? name : "secret";
              hits[category] = (hits[category] ?? 0) + 1;
              if (custom) return numbered(name, match);
              return scopes.mask.has(name) ? (PLACEHOLDER.get(name) ?? "[REDACTED]") : match;
            },
            scopes.detect,
            org,
            answerSpans,
          ),
        );
        return { text: masked, hits };
      } catch (err) {
        // The answer may already be on its way: withhold this text rather than send it unmasked
        const timeout = err instanceof PiiPatternTimeoutError;
        log({
          ...base,
          type: "blocked",
          ruleId: timeout ? "pii:pattern-timeout" : "pii:masking-failed",
          reason: timeout ? err.message : `masking the answer failed (${err instanceof Error ? err.name : typeof err})`,
        });
        return { text: `[GuardBee: withheld, ${timeout ? "a block pattern ran over its time budget" : "masking failed"}]`, hits: {} };
      }
    };
    const clientUsage = typeof forward["stream_options"] === "object" && (forward["stream_options"] as Json | null)?.["include_usage"] === true;
    if (wantsStream && shape === "openai") {
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
    const endpoint = ENDPOINTS[shape];
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
      if (usage) void budgets.record(llm.budgets, { ...caller, model }, usage, cost);
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
      const dropUsage = shape === "openai" && !clientUsage;
      const relay = rewrite ? new SseRewriter(shape, rewriteText, dropUsage, prepareAnswer) : new SseRelay(shape, dropUsage);
      if (upstream.body) {
        const reader = upstream.body.getReader();
        // The client went away: stop reading so the provider stops generating
        res.on("close", () => void reader.cancel().catch(() => {}));
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const out = await relay.push(value);
          if (out) res.write(out);
        }
      }
      const rest = await relay.end();
      res.end(rest);
      const streamHits = relay instanceof SseRewriter ? relay.hits : {};
      finish(relay.usage, Object.keys(streamHits).length > 0 ? { piiHits: streamHits } : {});
      return;
    }

    let completion = (await upstream.json()) as Json;
    const answerHits: Record<string, number> = {};
    if (rewrite && prepareAnswer) {
      const texts: string[] = [];
      mapCompletion(shape, completion, (text) => (texts.push(text), text));
      await prepareAnswer(texts);
    }
    completion = mapCompletion(shape, completion, (text) => {
      const out = rewriteText(text);
      for (const [category, count] of Object.entries(out.hits)) answerHits[category] = (answerHits[category] ?? 0) + count;
      return out.text;
    });
    finish(usageOf(shape, completion), Object.keys(answerHits).length > 0 ? { piiHits: answerHits } : {});
    sendJson(res, 200, completion);
  };

  const listModels = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const caller = await identify(req);
    const literal = llm.routes.filter((r) => !/[*?]/.test(r.model) && mayUse(caller, r.model));
    sendJson(res, 200, { object: "list", data: literal.map((r) => ({ id: r.model, object: "model", created: 0, owned_by: r.provider })) });
  };

  return async (req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const shape = req.method === "POST" && path.startsWith(`${llm.path}/`) ? CLIENT_PATHS[path.slice(llm.path.length)] : undefined;
    const models = req.method === "GET" && path === `${llm.path}/models`;
    if (!shape && !models) return false;
    try {
      if (models) await listModels(req, res);
      else await handle(req, res, shape!);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : typeof (err as { status?: unknown }).status === "number" ? (err as { status: number }).status : 500;
      const message = err instanceof Error ? err.message : "Internal error";
      if (!res.headersSent) sendJson(res, status, errorBody(apiOf(shape ?? "openai"), status, message, err instanceof HttpError ? err.code : undefined), err instanceof HttpError ? err.headers : {});
      else res.end();
    }
    return true;
  };
}
