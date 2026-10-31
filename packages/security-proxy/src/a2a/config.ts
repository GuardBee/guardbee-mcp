import { z } from "zod";
import type { A2aConfig } from "./gateway.js";

const agentSchema = z
  .object({
    url: z.string().url(),
    cardUrl: z.string().url().optional(),
    /** Sent to the agent; values may use ${VAR}. */
    headers: z.record(z.string(), z.string()).optional(),
    allowGroups: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const a2aSchema = z
  .object({
    path: z.string().startsWith("/").default("/a2a"),
    agents: z.record(z.string().regex(/^[A-Za-z0-9_-]+$/, "agent names are letters, digits, _ and -"), agentSchema),
    injection: z.enum(["block", "warn"]).default("block"),
    maskRequests: z.boolean().default(true),
    maskResponses: z.boolean().default(false),
    pushAllowHosts: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type A2aConfigInput = z.infer<typeof a2aSchema>;

export function resolveA2aConfig(raw: A2aConfigInput, interpolate: (value: string, where: string) => string): A2aConfig {
  return {
    path: raw.path.replace(/\/$/, "") || "/a2a",
    injection: raw.injection,
    maskRequests: raw.maskRequests,
    maskResponses: raw.maskResponses,
    pushAllowHosts: raw.pushAllowHosts,
    agents: Object.fromEntries(
      Object.entries(raw.agents).map(([name, agent]) => [
        name,
        {
          url: agent.url,
          ...(agent.cardUrl ? { cardUrl: agent.cardUrl } : {}),
          ...(agent.allowGroups ? { allowGroups: agent.allowGroups } : {}),
          ...(agent.headers ? { headers: Object.fromEntries(Object.entries(agent.headers).map(([k, v]) => [k, interpolate(v, `a2a.agents.${name}.headers.${k}`)])) } : {}),
        },
      ]),
    ),
  };
}
