import { labelTool, type Label } from "../gateway/labels.js";

/**
 * Labels for a coding agent's built-in tools, which never pass through the
 * proxy: a shell command, a file read, a web fetch. The same four labels the
 * proxy gives MCP tools, so the same rules and toxic-flow check apply.
 */

/** Files whose contents are credentials or keys. */
const SECRET_PATH = new RegExp(
  [
    String.raw`(?:^|[/\\])\.env(?:\.[\w.-]+)?$`,
    String.raw`(?:^|[/\\])\.ssh[/\\]`,
    String.raw`(?:^|[/\\])id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$`,
    String.raw`(?:^|[/\\])\.aws[/\\](?:credentials|config)$`,
    String.raw`(?:^|[/\\])\.config[/\\]gcloud[/\\]`,
    String.raw`(?:^|[/\\])\.azure[/\\]`,
    String.raw`(?:^|[/\\])\.kube[/\\]config$`,
    String.raw`(?:^|[/\\])\.docker[/\\]config\.json$`,
    String.raw`(?:^|[/\\])\.(?:npmrc|pypirc|netrc|pgpass|git-credentials)$`,
    String.raw`(?:^|[/\\])(?:credentials|secrets?|service[-_]account)[\w.-]*\.(?:json|ya?ml|toml)$`,
    String.raw`\.(?:pem|key|p12|pfx|keystore|jks)$`,
    String.raw`(?:^|[/\\])\.terraform[/\\].*\.tfstate$|\.tfstate$`,
  ].join("|"),
  "i",
);

/** Same paths inside a shell command (unanchored, followed by a space, quote or the end). */
const SECRET_IN_COMMAND = new RegExp(
  String.raw`(?:^|[\s'"=<])(?:[^\s'"]*[/\\])?(?:\.env(?:\.[\w.-]+)?|\.ssh[/\\]\S*|id_(?:rsa|dsa|ecdsa|ed25519)|\.aws[/\\]credentials|\.kube[/\\]config|\.npmrc|\.pypirc|\.netrc|\.pgpass|\.git-credentials|[\w.-]+\.(?:pem|key|p12|pfx)|[\w.-]*\.tfstate)(?=$|[\s'"|;&)>])`,
  "i",
);

const COMMANDS: { label: Label; pattern: RegExp }[] = [
  // Reading secrets without a file: the environment, keychains, cloud CLIs
  { label: "sensitive", pattern: /(?:^|[\s;&|(])(?:env|printenv|set)\s*(?:$|[;&|)])|\bsecurity\s+find-(?:generic|internet)-password\b|\b(?:aws\s+configure\s+get|gcloud\s+auth\s+print-(?:access|identity)-token|az\s+account\s+get-access-token|gh\s+auth\s+token|kubectl\s+get\s+secrets?)\b/i },
  // Sending data out
  {
    label: "egress",
    pattern:
      /(?:^|[\s;&|(`$])(?:curl|wget|nc|ncat|netcat|socat|scp|sftp|rsync|ftp|tftp|telnet|ssh|http|https|xh)\s|\bgit\s+push\b|\b(?:npm|pnpm|yarn|bun)\s+publish\b|\bdocker\s+push\b|\bgh\s+(?:gist|issue|pr|release|api)\b|\baws\s+s3\s+(?:cp|sync|mv)\b|\bgsutil\s+cp\b|\bInvoke-(?:WebRequest|RestMethod)\b|\b(?:fetch|requests\.(?:get|post|put)|urllib\.request|http\.client)\b/i,
  },
  // Fetching content someone else wrote
  { label: "untrusted", pattern: /(?:^|[\s;&|(`$])(?:curl|wget|http|https|xh)\s|\bgit\s+(?:clone|pull|fetch)\b|\bgh\s+(?:issue|pr)\s+view\b/i },
  // Hard to undo
  {
    label: "destructive",
    pattern:
      /\brm\s+(?:-[a-z]*(?:r[a-z]*f|f[a-z]*r)[a-z]*|--recursive\s+--force|--force\s+--recursive)\b|\bgit\s+push\s+(?:.*\s)?(?:--force|-f)\b|\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f)\b|\b(?:drop\s+(?:table|database|schema)|truncate\s+table)\b|\bmkfs(?:\.\w+)?\b|\bdd\s+if=|\bterraform\s+destroy\b|\bkubectl\s+delete\b/i,
  },
];

export function isSecretPath(path: string): boolean {
  return SECRET_PATH.test(path);
}

export function labelCommand(command: string): Label[] {
  const labels = new Set<Label>();
  if (SECRET_IN_COMMAND.test(command)) labels.add("sensitive");
  for (const { label, pattern } of COMMANDS) if (pattern.test(command)) labels.add(label);
  return [...labels];
}

const str = (value: unknown) => (typeof value === "string" ? value : "");

/** Claude Code tool names (Cursor's events are mapped onto these). */
export function labelAgentTool(tool: string, input: Record<string, unknown>): Label[] {
  switch (tool) {
    case "Bash":
    case "Shell":
      return labelCommand(str(input["command"]));
    case "Read":
    case "NotebookRead":
      return isSecretPath(str(input["file_path"]) || str(input["notebook_path"])) ? ["sensitive"] : [];
    case "Grep":
    case "Glob":
    case "LS":
      return isSecretPath(str(input["path"])) || SECRET_IN_COMMAND.test(` ${str(input["pattern"])}`) ? ["sensitive"] : [];
    case "WebFetch":
    case "WebSearch":
      // Reads what others wrote, and the URL or query itself can carry data out
      return ["untrusted", "egress"];
    default:
      // MCP tools (mcp__server__tool) and anything new: the proxy's name heuristics
      return labelTool({ name: tool.startsWith("mcp__") ? tool.split("__").slice(2).join("__") || tool : tool });
  }
}
