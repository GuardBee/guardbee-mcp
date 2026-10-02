import { z } from "zod";

/**
 * The policy part of a GuardBee MCP gateway config: what may run and how.
 * security-proxy reads it from guardbee-proxy.yaml or from the dashboard; the
 * dashboard validates an edit with the same schema before it saves it, so a
 * policy that saves is a policy the proxy accepts. Deployment settings
 * (upstreams, listen, audit) stay out: they hold commands and secrets.
 */

export const POLICY_LABELS = ["untrusted", "sensitive", "egress", "destructive"] as const;
export const POLICY_ACTIONS = ["allow", "deny", "mask", "warn", "approve"] as const;

const labelSchema = z.enum(POLICY_LABELS);
const actionSchema = z.enum(POLICY_ACTIONS);
const interceptorSchema = z.object({ enabled: z.boolean(), action: z.enum(["block", "warn"]) }).strict();

export const policyRuleSchema = z
  .object({
    id: z.string().optional(),
    match: z
      .object({
        tool: z.string().optional(),
        upstream: z.string().optional(),
        label: labelSchema.optional(),
        session: z.enum(["clean", "tainted"]).optional(),
        args: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
      })
      .strict(),
    action: actionSchema,
    mask: z.object({ fields: z.array(z.string()).min(1) }).strict().optional(),
  })
  .strict()
  .refine((rule) => rule.mask === undefined || rule.action === "mask", {
    message: "mask.fields only applies to action: mask",
    path: ["mask"],
  });

/** Every field has a default, so `{}` is a valid (allow-all, strict-taint) policy. */
export const policyShape = {
  labels: z.record(z.string(), z.array(labelSchema)).default({}),
  rules: z.array(policyRuleSchema).default([]),
  taint: z.object({ mode: z.enum(["strict", "approve", "warn", "off"]).default("strict") }).strict().default({ mode: "strict" }),
  approval: z
    .object({
      timeoutSeconds: z.number().int().positive().default(120),
      channels: z.array(z.enum(["elicitation", "dashboard"])).min(1).default(["elicitation"]),
    })
    .strict()
    .default({ timeoutSeconds: 120, channels: ["elicitation"] }),
  defaults: z.object({ action: actionSchema.default("allow") }).strict().default({ action: "allow" }),
  interceptors: z
    .object({
      promptInjection: interceptorSchema.optional(),
      toolResultInjection: interceptorSchema.optional(),
      definitionDrift: interceptorSchema.extend({ recheck: z.enum(["every-call", "on-change"]).optional() }).optional(),
      piiMasking: z
        .object({
          enabled: z.boolean(),
          patterns: z.array(z.string()).optional(),
          mode: z.enum(["redact", "tokenize"]).optional(),
          detokenizeForEgress: z.boolean().optional(),
        })
        .strict()
        .optional(),
    })
    .strict()
    .default({}),
};

export const gatewayPolicySchema = z.object(policyShape).strict();

export type GatewayPolicy = z.infer<typeof gatewayPolicySchema>;

export type PolicyValidation = { ok: true; policy: GatewayPolicy } | { ok: false; issues: string[] };

/** Validate an already-parsed policy document; issues read `path: message`. */
export function validatePolicy(value: unknown): PolicyValidation {
  const parsed = gatewayPolicySchema.safeParse(value ?? {});
  if (parsed.success) return { ok: true, policy: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
  };
}
