export type ElicitationCategory =
  | "form-secrets"
  | "url-binding"
  | "url-exposure"
  | "transport"
  | "identity"
  | "completion";

export interface ElicitationCheck {
  id: string;
  name: string;
  category: ElicitationCategory;
  severity: "critical" | "high" | "medium";
  recommendation: string;
}

/**
 * Checks derived from the MCP elicitation spec (2026-07-28), Security
 * Considerations. Sampling and roots are deprecated in that revision;
 * elicitation is the remaining server-to-client request surface.
 */
export const ELICITATION_CHECKS: ElicitationCheck[] = [
  {
    id: "form_mode_secret",
    name: "Form-mode elicitation asks for a secret or payment credential",
    category: "form-secrets",
    severity: "critical",
    recommendation:
      "The MCP spec forbids form-mode elicitation for passwords, API keys, access tokens, and payment credentials. That data passes through the MCP client and can land in logs or the model context. Collect it with URL mode, on a page the client never reads.",
  },
  {
    id: "url_third_party_authorize",
    name: "URL-mode elicitation opens a third-party authorize endpoint directly",
    category: "url-binding",
    severity: "critical",
    recommendation:
      "A URL-mode link can be forwarded. The spec's phishing mitigation is to open your own /connect route first, confirm the browser session subject matches the MCP user who started the elicitation, and only then redirect to the third-party authorization endpoint.",
  },
  {
    id: "url_embeds_credential",
    name: "URL-mode elicitation URL carries a credential",
    category: "url-exposure",
    severity: "critical",
    recommendation:
      "The elicitation URL is shown to the MCP client. The spec says it MUST NOT contain credentials or a pre-authenticated grant (access_token, refresh_token, api_key, password, authorization code). Put that material in the out-of-band page, not in the URL.",
  },
  {
    id: "url_embeds_pii",
    name: "URL-mode elicitation URL carries personal data",
    category: "url-exposure",
    severity: "high",
    recommendation:
      "The spec says a URL-mode elicitation URL MUST NOT include personal data about the end user. Drop the email or other identifier from the query string; bind the flow to the authenticated MCP subject on your own connect route instead.",
  },
  {
    id: "elicitation_url_not_https",
    name: "URL-mode elicitation uses a cleartext HTTP URL",
    category: "transport",
    severity: "medium",
    recommendation:
      "The spec says elicitation URLs SHOULD be HTTPS outside local development. An http:// link can be rewritten in transit before the user enters credentials on the far side.",
  },
  {
    id: "form_clickable_url",
    name: "Form-mode elicitation contains a clickable URL",
    category: "form-secrets",
    severity: "medium",
    recommendation:
      "The spec says a form-mode request SHOULD NOT include a URL the user is meant to click. Form text is rendered inside the MCP client, so a link there is a phishing prompt sitting next to the form. Send the user out of band with URL mode instead.",
  },
  {
    id: "client_asserted_identity",
    name: "Form answer is used as the user's identity",
    category: "identity",
    severity: "high",
    recommendation:
      "The spec says a server MUST NOT treat something the user typed, such as an email address, as proof of who they are. Identify the user from the MCP authorization credential (the sub claim) and keep the form answer as data, not as the account.",
  },
  {
    id: "ignored_decline",
    name: "Elicitation result is used without checking decline or cancel",
    category: "completion",
    severity: "high",
    recommendation:
      "The spec says a server MUST handle decline and cancel, and MUST NOT assume the user submitted the form. Read the action field and skip the content unless the action is accept.",
  },
];

export function checkById(id: string): ElicitationCheck {
  const found = ELICITATION_CHECKS.find((check) => check.id === id);
  if (!found) throw new Error(`Unknown elicitation check: ${id}`);
  return found;
}
