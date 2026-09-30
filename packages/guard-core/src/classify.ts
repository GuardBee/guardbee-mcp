export type Capability =
  | "untrusted-content"
  | "sensitive-data"
  | "exfiltration"
  | "destructive";

export type FlowCategory = "toxic-flow" | "dangerous-pair" | "capability";

export interface ToolRecord {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/** Name/description/schema heuristics for Simon Willison's lethal trifecta. */
export const CAPABILITY_RULES: Record<Capability, RegExp> = {
  "untrusted-content":
    /\b(fetch|scrape|browse|crawl|http|https?|url|web[_-]?search|search[_-]?web|read[_-]?page|download|wiki|rss|feed|issue|ticket|inbox|comment|tweet|reddit|html|screenshot)\b/i,
  "sensitive-data":
    /\b(secret|credential|token|api[_-]?key|password|passwd|vault|private[_-]?key|ssh|env|database|sql|postgres|mysql|mongo|payment|card|iban|kvkk|pii|tc[_-]?kimlik|identity|müşteri|musteri|kullanıcı|kullanici|email|e-mail|mailbox|inbox|read[_-]?file|read[_-]?secret|get[_-]?secret|list[_-]?secret|dump|export[_-]?user)\b/i,
  "exfiltration":
    /\b(send|post|publish|upload|email|mail|notify|webhook|export|sync|push|transfer|message|slack|discord|telegram|http[_-]?request|fetch[_-]?post|write[_-]?url|relay|forward|pull[_ -]?request)\b/i,
  destructive:
    /\b(delete|remove|drop|destroy|purge|reset|truncate|revoke|kill|terminate|overwrite|wipe|rm\b|unlink)\b/i,
};

/**
 * `\b` treats `_` as a word character, so `\bvault\b` never matches inside
 * `read_vault_secret`. Append a copy with `_`/`-` turned into spaces; the
 * original stays so compound rules like `api[_-]?key` still match.
 */
function withWordBreaks(text: string): string {
  return `${text}\n${text.replace(/[_-]+/g, " ")}`;
}

export function textOf(tool: ToolRecord): string {
  const schema = tool.inputSchema ? JSON.stringify(tool.inputSchema) : "";
  return withWordBreaks(`${tool.name}\n${tool.description ?? ""}\n${schema}`);
}

export function classifyTool(tool: ToolRecord): Capability[] {
  const text = textOf(tool);
  const name = withWordBreaks(tool.name);
  const found: Capability[] = [];

  // Untrusted / exfil / destructive: name is primary (CheckMCP-style); description reinforces.
  if (CAPABILITY_RULES["untrusted-content"].test(name) || CAPABILITY_RULES["untrusted-content"].test(text)) {
    found.push("untrusted-content");
  }
  if (CAPABILITY_RULES.exfiltration.test(name) || CAPABILITY_RULES.exfiltration.test(text)) {
    found.push("exfiltration");
  }
  if (CAPABILITY_RULES.destructive.test(name) || CAPABILITY_RULES.destructive.test(text)) {
    found.push("destructive");
  }
  // Sensitive: name + description + schema (secrets often hide in schema field names).
  if (CAPABILITY_RULES["sensitive-data"].test(text)) {
    found.push("sensitive-data");
  }

  return found;
}
