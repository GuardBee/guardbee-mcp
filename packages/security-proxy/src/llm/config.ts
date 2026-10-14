import { z } from "zod";

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

export interface LlmConfig {
  /** Prefix of the endpoints: <path>/chat/completions, <path>/messages, <path>/models. */
  path: string;
  providers: Record<string, LlmProvider>;
  routes: LlmRoute[];
  keys: LlmVirtualKey[];
  /** Price per model glob, for cost in the audit log and costUsd budgets. */
  pricing: Record<string, LlmPrice>;
  budgets: LlmBudget[];
  /** Also mask PII the model writes in its answer (prompts are always checked). */
  maskResponses: boolean;
  timeoutSeconds: number;
}

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
    routes: z.array(z.object({ model: z.string().min(1), provider: z.string().min(1) }).strict()).min(1),
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
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const [index, route] of value.routes.entries()) {
      if (!value.providers[route.provider]) {
        ctx.addIssue({ code: "custom", path: ["routes", index, "provider"], message: `no provider named "${route.provider}"` });
      }
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
  };
}
