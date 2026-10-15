import { z } from "zod";
import { checkOrgPatterns, orgPatternShape } from "./org-patterns.js";
import { checkPiiDetectorNames, piiSelectionSchema, piiSelectionShape } from "./presets.js";

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
/** At most `count` events within `windowSeconds`; one more trips the anomaly check. */
const anomalyWindowSchema = z
  .object({ count: z.number().int().positive(), windowSeconds: z.number().int().positive().max(86_400) })
  .strict();

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
        user: z.string().min(1).optional(),
        group: z.string().min(1).optional(),
        /** Id of a topic in `topics`: the arguments, result or prompt are about it. */
        topic: z.string().min(1).optional(),
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

/** At most `limit` calls per `windowSeconds`, counted across sessions per user, session or gateway. */
export const quotaRuleSchema = z
  .object({
    id: z.string().optional(),
    match: z
      .object({
        tool: z.string().optional(),
        upstream: z.string().optional(),
        label: labelSchema.optional(),
        user: z.string().min(1).optional(),
        group: z.string().min(1).optional(),
      })
      .strict()
      .default({}),
    limit: z.number().int().positive(),
    windowSeconds: z.number().int().positive().max(2_592_000),
    per: z.enum(["user", "session", "gateway"]).default("user"),
  })
  .strict();

/** A subject a rule can match on (see topics.ts for how terms match). */
export const topicSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, "topic ids use lower-case letters, digits, - and _"),
    description: z.string().max(500).optional(),
    terms: z.array(z.string().trim().min(1).max(200)).min(1).max(500),
    minMatches: z.number().int().positive().default(1),
  })
  .strict()
  .refine((topic) => topic.minMatches <= topic.terms.length, { message: "minMatches is larger than the number of terms", path: ["minMatches"] });

/** Every field has a default, so `{}` is a valid (allow-all, strict-taint) policy. */
export const policyShape = {
  labels: z.record(z.string(), z.array(labelSchema)).default({}),
  /** Subjects for `match.topic`, e.g. mergers & acquisitions, salaries, unreleased source code. */
  topics: z.array(topicSchema).default([]),
  /**
   * Which tools the agent sees, by the name it sees (globs). `expose` is an
   * allowlist (absent: every tool), `hide` removes tools after it. A hidden
   * tool is left out of tools/list and its calls are refused. `descriptions`
   * replaces a tool's description with one you wrote.
   */
  tools: z
    .object({
      expose: z.array(z.string().min(1)).optional(),
      hide: z.array(z.string().min(1)).default([]),
      descriptions: z.record(z.string(), z.string().min(1).max(2000)).default({}),
    })
    .strict()
    .default({ hide: [], descriptions: {} }),
  rules: z.array(policyRuleSchema).default([]),
  quotas: z.array(quotaRuleSchema).default([]),
  taint: z
    .object({
      mode: z.enum(["strict", "approve", "warn", "off"]).default("strict"),
      /**
       * capability: any egress call after untrusted + sensitive content is a toxic flow.
       * data: only an egress call whose arguments carry sensitive data the session saw.
       */
      basis: z.enum(["capability", "data"]).default("capability"),
    })
    .strict()
    .default({ mode: "strict", basis: "capability" }),
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
      /** Poisoned tool definitions in tools/list (injected instructions, hidden characters, read-only lies). */
      toolPoisoning: interceptorSchema.optional(),
      /** Credentials (provider keys, private keys, DB URLs with passwords) in the arguments of an egress tool. */
      egressSecrets: interceptorSchema.extend({ allowTools: z.array(z.string().min(1)).optional() }).optional(),
      /**
       * Servers asking the agent's model for a completion (sampling/createMessage).
       * Off: the proxy does not offer sampling to servers. Read at start: a change needs a restart.
       */
      sampling: interceptorSchema
        .extend({
          maxTokens: z.number().int().positive().max(100_000).optional(),
          maxPerCall: z.number().int().positive().max(100).optional(),
          approval: z.boolean().optional(),
        })
        .optional(),
      piiMasking: z
        .object({
          enabled: z.boolean(),
          patterns: z.array(z.string()).optional(),
          mode: z.enum(["redact", "tokenize"]).optional(),
          /** Opt-in detectors: network identifiers and plates are off unless listed. */
          include: z.array(z.enum(["ip_address", "mac_address", "plate_tr"])).optional(),
          detokenizeForEgress: z.boolean().optional(),
          /** Which detectors mask: a preset, then enable / disable by detector name. */
          ...piiSelectionShape,
          /** Per upstream (or LLM provider) by name: replaces the selection above for it. */
          upstreams: z.record(z.string(), piiSelectionSchema).optional(),
          /** The organization's own patterns: block masks what no detector knows, allow exempts detected values. */
          ...orgPatternShape,
        })
        .strict()
        .superRefine((masking, ctx) => {
          checkPiiDetectorNames(masking, ctx);
          checkOrgPatterns(masking, ctx);
        })
        .optional(),
      /**
       * PII and credentials inside images, PDFs and other blobs in tool results
       * and resources (text layer, OCR when tesseract.js is installed). Off by default.
       */
      documents: interceptorSchema
        .extend({ ocr: z.boolean().optional(), maxBytes: z.number().int().positive().max(100 * 1024 * 1024).optional() })
        .optional(),
      /** Behaviour over a session: call bursts, sweeps of sensitive reads, bulk destructive calls, repeated blocks. */
      anomaly: interceptorSchema
        .extend({
          callBurst: anomalyWindowSchema.optional(),
          sensitiveSweep: anomalyWindowSchema.optional(),
          destructiveBurst: anomalyWindowSchema.optional(),
          repeatedBlocks: anomalyWindowSchema.optional(),
        })
        .optional(),
    })
    .strict()
    .default({}),
};

/**
 * Cross-field checks the object shape cannot express: unique topic ids, and
 * every `match.topic` naming a defined topic. Shared with the proxy's YAML
 * schema, which spreads policyShape into a larger object.
 */
export function checkTopicReferences(
  policy: { topics: readonly { id: string }[]; rules: readonly { match: { topic?: string | undefined } }[] },
  ctx: z.RefinementCtx,
): void {
  const ids = new Set<string>();
  for (const [index, topic] of policy.topics.entries()) {
    if (ids.has(topic.id)) ctx.addIssue({ code: "custom", path: ["topics", index, "id"], message: `duplicate topic id "${topic.id}"` });
    ids.add(topic.id);
  }
  for (const [index, rule] of policy.rules.entries()) {
    const topic = rule.match.topic;
    if (topic !== undefined && !ids.has(topic)) {
      ctx.addIssue({ code: "custom", path: ["rules", index, "match", "topic"], message: `no topic with id "${topic}" in topics` });
    }
  }
}

export const gatewayPolicySchema = z.object(policyShape).strict().superRefine(checkTopicReferences);

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
