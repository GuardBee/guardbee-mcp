export type A2AAuditCategory = "webhook-ssrf" | "missing-authentication" | "credential-exposure";

export interface A2AAuditPattern {
  id: string;
  name: string;
  category: A2AAuditCategory;
  pattern: RegExp;
  severity: "critical" | "high" | "medium";
  recommendation: string;
}

/**
 * Google's Agent2Agent (A2A) protocol has no MCP-style spec section calling
 * these out by name yet, so these come from reading the reference SDKs
 * (@a2a-js/sdk, a2a-sdk) directly: the official push-notification sender
 * fetches a client-supplied webhook URL with no host check, and the official
 * sample agent ships with an empty security scheme and a literal
 * `noAuthentication` request handler — both patterns below are taken from
 * real SDK/sample source, not invented. The remaining checks (indirected
 * webhook fetch, Python AgentCard missing security kwargs, credential
 * embedded in card metadata) need call/object-span context and live in
 * scanner.ts instead of a flat regex.
 */
export const A2A_AUDIT_PATTERNS: A2AAuditPattern[] = [
  {
    id: "webhook_url_direct_fetch_no_allowlist",
    name: "Push-notification webhook URL fetched directly from client-supplied config",
    category: "webhook-ssrf",
    pattern: /(?:fetch|axios(?:\.\w+)?)\s*\(\s*\w*(?:push|webhook|notification)\w*Config\.url\b/gi,
    severity: "critical",
    recommendation: "A2A's TaskPushNotificationConfig.url is supplied by whichever client set up the subscription, and the reference push-notification sender fetches it with no host validation — a caller can point this server at an internal service or cloud metadata endpoint (SSRF). Validate the host against an allowlist before fetching it.",
  },
  {
    id: "no_authentication_user_builder",
    name: "Request handler wired up with UserBuilder.noAuthentication",
    category: "missing-authentication",
    pattern: /UserBuilder\.noAuthentication\b/g,
    severity: "critical",
    recommendation: "UserBuilder.noAuthentication means every A2A task request is accepted with no identity check at all — this is what the SDK's own sample agent ships with, which makes it an easy copy-paste trap. Any caller who can reach this endpoint can invoke any skill the Agent Card advertises. Use a real userBuilder (see the SDK's authentication sample) in anything that isn't a local demo.",
  },
];
