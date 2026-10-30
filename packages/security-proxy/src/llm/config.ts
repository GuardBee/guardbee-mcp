import { z } from "zod";
import { globToRegExp } from "../gateway/policy.js";

/** Which API a provider speaks; a request is only routed to a provider of its own shape. */
export type LlmApi = "openai" | "anthropic";

export interface LlmProvider {
  name: string;
  api: LlmApi;
  /** e.g. https://api.openai.com/v1 or https://api.anthropic.com */
  baseUrl: string;
  /** The real provider key, resolved from apiKeyEnv; never leaves the proxy. */
  apiKey: string;
  headers: Record<string, string>;
}

export interface LlmRoute {
  /** Glob on the model name the client asks for. */
  model: string;
  provider: string;
  /**
   * `off`: PII in requests to this route is counted but not masked, and
   * nothing is refused as unmaskable. Every such request is written to the
   * audit log (`pii:masking-off`). A topic rule with action `mask` still masks.
   */
  masking?: "on" | "off";
}

/** A gateway key handed to a person or an app instead of the provider key. */
export interface LlmVirtualKey {
  key: string;
  user: string;
  groups: string[];
}

/** USD per one million tokens. */
export interface LlmPrice {
  input: number;
  output: number;
}

export interface LlmBudget {
  id?: string;
  /** All given fields must match (model and user are globs; group is one of the caller's groups). */
  match: { model?: string; user?: string; group?: string };
  /** Who shares a counter: each user (else each key or session), or the whole gateway. */
  per: "user" | "gateway";
  windowSeconds: number;
  requests?: number;
  /** Input + output tokens, as the provider reported them. */
  tokens?: number;
  /** Needs `pricing` for the models it covers. */
  costUsd?: number;
}

/** Which models a caller may ask for; every entry that matches the caller adds its globs. */
export interface LlmAccessRule {
  /** Glob on the caller's user (gateway key user or OIDC user). */
  user?: string;
  /** One of the caller's groups. */
  group?: string;
  allow: string[];
}

/**
 * Send a prompt that holds personal data (or a listed topic) to a model you
 * run yourself instead of the one asked for. The model must have a route for
 * the request's API; if it has none, the request is refused, never sent on.
 */
export interface LlmSensitiveRoute {
  model: string;
  on: {
    /** Any personal data the PII detectors find (default true). */
    pii: boolean;
    /** Only these PII categories count (absent: all). */
    categories?: string[];
    /** Topic ids (top-level `topics`) that also count. */
    topics?: string[];
  };
  /** Keep masking the prompt on the routed request (default false: the data stays in-house). */
  mask: boolean;
}

export interface LlmConfig {
  /** Prefix of the endpoints: <path>/chat/completions, <path>/messages, <path>/models. */
  path: string;
  providers: Record<string, LlmProvider>;
  routes: LlmRoute[];
  keys: LlmVirtualKey[];
  /** Price per model glob, for cost in the audit log and costUsd budgets. */
  pricing: Record<string, LlmPrice>;
  budgets: LlmBudget[];
  access: LlmAccessRule[];
  /** For a caller no access entry matches. */
  accessDefault: "allow" | "deny";
  sensitive?: LlmSensitiveRoute;
  /** Also mask PII the model writes in its answer (prompts are always checked). */
  maskResponses: boolean;
  timeoutSeconds: number;
  /** Longest single text (message, part, tool result) the proxy masks; a longer one is refused with 413. */
  maxTextChars?: number;
  /** Read inline PDFs (and, with OCR, images) instead of refusing or passing them unchecked (llm/documents.ts). */
  documents?: LlmDocuments;
}

/**
 * PDFs and images in requests. With `pdf: true` an inline PDF's text is
 * read, with `images: true` an inline image's text is read with OCR, and that
 * text goes through every prompt check. One that is clean is forwarded
 * unchanged, one that holds PII the proxy would mask is refused (masking
 * inside a PDF or an image is not possible), and one that cannot be read in
 * full is unmaskable (415).
 */
export interface LlmDocuments {
  pdf: boolean;
  /** OCR inline images (needs tesseract.js). Off: images are forwarded unchecked, as without llm.documents. */
  images: boolean;
  /** OCR PDF pages without a text layer (needs tesseract.js and @napi-rs/canvas). Off: such pages make the PDF unreadable. */
  ocr: boolean;
  /** Tesseract languages for OCR. */
  languages: string[];
  /** A local folder with `<lang>.traineddata`, so OCR never downloads language data. */
  langPath?: string;
  maxBytes: number;
  maxPages: number;
  timeoutSeconds: number;
}

export const DEFAULT_MAX_TEXT_CHARS = 2_000_000;
/** Largest request body the gateway reads. */
export const MAX_BODY_BYTES = 32 * 1024 * 1024;

const envName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "the name of an environment variable");

export const llmSchema = z
  .object({
    path: z
      .string()
      .regex(/^\/[A-Za-z0-9/_-]*[^/]$/, "a path like /v1 (no trailing slash)")
      .default("/v1"),
    providers: z
      .record(
        z.string().regex(/^[A-Za-z0-9-_]+$/, "provider names use letters, digits, - and _"),
        z
          .object({
            api: z.enum(["openai", "anthropic"]),
            baseUrl: z.string().regex(/^https?:\/\//, "baseUrl must start with http:// or https://"),
            apiKeyEnv: envName,
            headers: z.record(z.string(), z.string()).default({}),
          })
          .strict(),
      )
      .refine((providers) => Object.keys(providers).length > 0, "at least one provider is required"),
    routes: z
      .array(z.object({ model: z.string().min(1), provider: z.string().min(1), masking: z.enum(["on", "off"]).optional() }).strict())
      .min(1),
    keys: z
      .array(
        z
          .object({
            keyEnv: envName,
            user: z.string().min(1),
            groups: z.array(z.string().min(1)).default([]),
          })
          .strict(),
      )
      .default([]),
    pricing: z
      .record(z.string().min(1), z.object({ input: z.number().min(0), output: z.number().min(0) }).strict())
      .default({}),
    budgets: z
      .array(
        z
          .object({
            id: z.string().min(1).optional(),
            match: z
              .object({ model: z.string().min(1).optional(), user: z.string().min(1).optional(), group: z.string().min(1).optional() })
              .strict()
              .default({}),
            per: z.enum(["user", "gateway"]).default("user"),
            windowSeconds: z.number().int().positive(),
            requests: z.number().int().positive().optional(),
            tokens: z.number().int().positive().optional(),
            costUsd: z.number().positive().optional(),
          })
          .strict()
          .refine((b) => b.requests !== undefined || b.tokens !== undefined || b.costUsd !== undefined, "a budget needs requests, tokens or costUsd"),
      )
      .default([]),
    maskResponses: z.boolean().default(false),
    timeoutSeconds: z.number().int().positive().default(120),
    maxTextChars: z.number().int().positive().default(DEFAULT_MAX_TEXT_CHARS),
    documents: z
      .object({
        pdf: z.boolean().default(false),
        images: z.boolean().default(false),
        ocr: z.boolean().default(false),
        languages: z.array(z.string().regex(/^[a-z_]{3,16}$/, "a Tesseract language code such as eng")).min(1).default(["tur", "eng"]),
        langPath: z.string().min(1).optional(),
        maxBytes: z.number().int().positive().max(MAX_BODY_BYTES).default(20 * 1024 * 1024),
        maxPages: z.number().int().positive().default(50),
        timeoutSeconds: z.number().int().positive().default(30),
      })
      .strict()
      .optional(),
    access: z
      .array(
        z
          .object({ user: z.string().min(1).optional(), group: z.string().min(1).optional(), allow: z.array(z.string().min(1)).min(1) })
          .strict()
          .refine((rule) => rule.user !== undefined || rule.group !== undefined, "an access entry needs user or group"),
      )
      .default([]),
    accessDefault: z.enum(["allow", "deny"]).default("allow"),
    sensitive: z
      .object({
        model: z.string().min(1),
        on: z
          .object({
            pii: z.boolean().default(true),
            categories: z.array(z.string().min(1)).min(1).optional(),
            topics: z.array(z.string().min(1)).min(1).optional(),
          })
          .strict()
          .default({ pii: true }),
        mask: z.boolean().default(false),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const [index, route] of value.routes.entries()) {
      if (!value.providers[route.provider]) {
        ctx.addIssue({ code: "custom", path: ["routes", index, "provider"], message: `no provider named "${route.provider}"` });
      }
    }
    if (value.sensitive && !value.routes.some((route) => globToRegExp(route.model).test(value.sensitive!.model))) {
      ctx.addIssue({ code: "custom", path: ["sensitive", "model"], message: `no route serves "${value.sensitive.model}"` });
    }
    if (value.budgets.some((b) => b.costUsd !== undefined) && Object.keys(value.pricing).length === 0) {
      ctx.addIssue({ code: "custom", path: ["pricing"], message: "a costUsd budget needs pricing for the models it covers" });
    }
  });

export type LlmYaml = z.infer<typeof llmSchema>;

function env(name: string, where: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Environment variable ${name} (${where}) is not set`);
  return value;
}

/** Resolve keys from the environment: the config file never holds a secret. */
export function resolveLlmConfig(raw: LlmYaml): LlmConfig {
  const keys = raw.keys.map((key, index) => ({ key: env(key.keyEnv, `llm.keys[${index}].keyEnv`), user: key.user, groups: key.groups }));
  if (new Set(keys.map((k) => k.key)).size !== keys.length) throw new Error("llm.keys: two entries resolve to the same key");
  return {
    path: raw.path,
    providers: Object.fromEntries(
      Object.entries(raw.providers).map(([name, p]) => [
        name,
        { name, api: p.api, baseUrl: p.baseUrl.replace(/\/$/, ""), apiKey: env(p.apiKeyEnv, `llm.providers.${name}.apiKeyEnv`), headers: p.headers },
      ]),
    ),
    routes: raw.routes,
    keys,
    pricing: raw.pricing,
    budgets: raw.budgets,
    maskResponses: raw.maskResponses,
    timeoutSeconds: raw.timeoutSeconds,
    maxTextChars: raw.maxTextChars,
    ...(raw.documents ? { documents: raw.documents } : {}),
    access: raw.access,
    accessDefault: raw.accessDefault,
    ...(raw.sensitive ? { sensitive: raw.sensitive } : {}),
  };
}
