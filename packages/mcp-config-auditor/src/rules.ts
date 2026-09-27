import type { ConfigFinding, InventoryServer, ParsedServer } from "./types.js";
import { isPinnedVersion, packageSpec, splitPackageSpec } from "./parseConfig.js";
import { looksLikeSecret, redactSecret, sensitiveEnvValue } from "./secrets.js";
import { findTyposquat } from "./typosquat.js";

function locate(text: string, needle: string): { line: number; column: number } {
  const idx = needle ? text.indexOf(needle) : -1;
  if (idx < 0) return { line: 1, column: 1 };
  const before = text.slice(0, idx);
  const line = before.split("\n").length;
  const lastNl = before.lastIndexOf("\n");
  return { line, column: idx - (lastNl === -1 ? 0 : lastNl + 1) + 1 };
}

function finding(
  partial: Omit<ConfigFinding, "line" | "column" | "file"> & { file?: string },
  text: string,
  needle: string
): ConfigFinding {
  const loc = locate(text, needle);
  return { ...partial, file: partial.file, line: loc.line, column: loc.column };
}

function isLoopback(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function hasAuth(server: ParsedServer): boolean {
  const headerNames = Object.keys(server.headers).map((name) => name.toLowerCase());
  if (headerNames.some((name) => name === "authorization" || name === "x-api-key" || name === "api-key")) return true;
  return Object.entries(server.env).some(([key, value]) => {
    return /(?:authorization|api[_-]?key|access[_-]?token|bearer)/i.test(key) && value.trim().length > 0;
  });
}

function argLooksSecret(arg: string): boolean {
  const eq = arg.indexOf("=");
  if (eq === -1) return looksLikeSecret(arg);
  const key = arg.slice(0, eq).replace(/^-+/, "");
  return sensitiveEnvValue(key, arg.slice(eq + 1));
}

function isWildcardApprove(value: unknown): boolean {
  if (value === true || value === "*") return true;
  return Array.isArray(value) && value.some((item) => item === "*");
}

export function auditServers(servers: ParsedServer[], text: string, file?: string): ConfigFinding[] {
  const findings: ConfigFinding[] = [];

  for (const server of servers) {
    const needle = `"${server.name}"`;
    const spec = packageSpec(server.command, server.args);
    if (spec) {
      const { name, version } = splitPackageSpec(spec);
      if (!isPinnedVersion(version)) {
        findings.push(
          finding(
            {
              patternId: "unpinned_package",
              patternName: "MCP server package is not pinned to a release version",
              category: "supply-chain",
              severity: "high",
              owasp: "MCP04:2025",
              recommendation:
                "Pin the package to an exact version (for example package@1.2.3) and re-check it when you upgrade. A floating tag such as @latest can change the tool list after you approved it.",
              server: server.name,
              file,
              match: `${server.command ?? ""} ${spec}`.trim(),
            },
            text,
            needle
          )
        );
      }
      const squat = findTyposquat(name);
      if (squat) {
        findings.push(
          finding(
            {
              patternId: "typosquat_package",
              patternName: "Package name is one edit away from a known MCP server package",
              category: "supply-chain",
              severity: "critical",
              owasp: "MCP04:2025",
              recommendation: `This package resembles ${squat.resembles}. Confirm the publisher before running it. One-character substitutions are a common way to ship a credential-stealing copy of a known server.`,
              server: server.name,
              file,
              match: name,
            },
            text,
            needle
          )
        );
      }
    }

    for (const [key, value] of Object.entries(server.env)) {
      if (!sensitiveEnvValue(key, value)) continue;
      findings.push(
        finding(
          {
            patternId: "secret_in_env",
            patternName: "Credential stored in the MCP server environment block",
            category: "secrets",
            severity: "critical",
            owasp: "MCP01:2025",
            recommendation:
              "Move the secret to an environment variable reference such as ${API_KEY} that the host resolves outside the config file. A literal token in mcp.json is readable by anyone with the file and is copied into the agent context.",
            server: server.name,
            file,
            match: `${key}=${redactSecret(value)}`,
          },
          text,
          needle
        )
      );
    }

    for (const arg of server.args) {
      if (spec && arg === spec) continue;
      if (!argLooksSecret(arg)) continue;
      findings.push(
        finding(
          {
            patternId: "secret_in_args",
            patternName: "Credential passed on the MCP server command line",
            category: "secrets",
            severity: "critical",
            owasp: "MCP01:2025",
            recommendation:
              "Command-line arguments show up in process listings and shell history. Pass credentials through an environment variable the host injects, not as an argv value.",
            server: server.name,
            file,
            match: redactSecret(arg),
          },
          text,
          needle
        )
      );
    }

    if (isWildcardApprove(server.autoApprove)) {
      findings.push(
        finding(
          {
            patternId: "auto_approve_wildcard",
            patternName: "Every tool on this server is auto-approved",
            category: "agency",
            severity: "critical",
            owasp: "MCP02:2025",
            recommendation:
              "Remove autoApprove \"*\" (or alwaysAllow: true). Approve individual tool names after reading what they do. A wildcard lets a later tool-definition change run without a prompt.",
            server: server.name,
            file,
            match: "autoApprove=*",
          },
          text,
          needle
        )
      );
    }

    if (server.url && !isLoopback(server.url)) {
      let parsedUrl: URL | null = null;
      try {
        parsedUrl = new URL(server.url);
      } catch {
        parsedUrl = null;
      }
      if (parsedUrl?.protocol === "http:") {
        findings.push(
          finding(
            {
              patternId: "cleartext_remote",
              patternName: "Remote MCP endpoint uses cleartext HTTP",
              category: "transport",
              severity: "high",
              owasp: "MCP07:2025",
              recommendation: "Use HTTPS for any MCP server that is not on localhost. Cleartext HTTP exposes tool arguments and results on the network.",
              server: server.name,
              file,
              match: server.url,
            },
            text,
            needle
          )
        );
      }
      if (parsedUrl && (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") && !hasAuth(server)) {
        findings.push(
          finding(
            {
              patternId: "unauthenticated_remote",
              patternName: "Remote MCP endpoint has no authorization header or token",
              category: "transport",
              severity: parsedUrl.protocol === "http:" ? "high" : "medium",
              owasp: "MCP07:2025",
              recommendation:
                "Require a bearer token or API key on remote MCP endpoints. An open URL can be called by any agent that reads this config, and by anyone else who can reach the host.",
              server: server.name,
              file,
              match: server.url,
            },
            text,
            needle
          )
        );
      }
    }
  }

  return findings;
}

const DESTRUCTIVE_REDIRECT = /\b(?:always|instead|must)\b/i;
const CALL_WORD = /\b(?:call|use|invoke)\b/i;

/**
 * Cross-server tool shadowing. Config files do not list tools, so this runs
 * on an inventory of live or saved tool catalogs: the same tool name on two
 * servers, confusable names, or a description that steers the model at another
 * server's tool.
 */
export function findToolShadowing(servers: InventoryServer[], file?: string): ConfigFinding[] {
  const findings: ConfigFinding[] = [];
  const byName = new Map<string, string[]>();

  for (const server of servers) {
    for (const tool of server.tools) {
      const key = tool.name.toLowerCase();
      const owners = byName.get(key) ?? [];
      if (!owners.includes(server.name)) owners.push(server.name);
      byName.set(key, owners);
    }
  }

  for (const [toolName, owners] of byName) {
    if (owners.length < 2) continue;
    findings.push({
      patternId: "cross_server_tool_shadow",
      patternName: `Tool "${toolName}" is registered by more than one MCP server`,
      category: "shadowing",
      severity: "high",
      owasp: "MCP03:2025",
      recommendation: `Servers ${owners.join(", ")} expose the same tool name. The model cannot tell which implementation it is calling. Rename one, or disconnect the server you did not intend to trust.`,
      server: owners.join(", "),
      file,
      line: 1,
      column: 1,
      match: toolName,
    });
  }

  const tools = servers.flatMap((server) => server.tools.map((tool) => ({ server: server.name, tool })));
  for (let i = 0; i < tools.length; i++) {
    for (let j = i + 1; j < tools.length; j++) {
      const left = tools[i];
      const right = tools[j];
      if (!left || !right) continue;
      if (left.server === right.server) continue;
      if (left.tool.name.toLowerCase() === right.tool.name.toLowerCase()) continue;
      if (confusable(left.tool.name, right.tool.name)) {
        findings.push({
          patternId: "confusable_tool_name",
          patternName: `Tool names "${left.tool.name}" and "${right.tool.name}" look alike across servers`,
          category: "shadowing",
          severity: "critical",
          owasp: "MCP03:2025",
          recommendation: `A homoglyph or one-character difference between ${left.server} and ${right.server} lets one server impersonate the other's tool. Disconnect the server you cannot attribute.`,
          server: `${left.server}, ${right.server}`,
          file,
          line: 1,
          column: 1,
          match: `${left.tool.name} ~ ${right.tool.name}`,
        });
      }
    }
  }

  for (const server of servers) {
    const foreign = tools.filter((entry) => entry.server !== server.name && entry.tool.name.length >= 4);
    for (const tool of server.tools) {
      const description = tool.description ?? "";
      if (!DESTRUCTIVE_REDIRECT.test(description) || !CALL_WORD.test(description)) continue;
      for (const other of foreign) {
        const nameRe = new RegExp(`\\b${escapeRegExp(other.tool.name)}\\b`, "i");
        if (!nameRe.test(description)) continue;
        findings.push({
          patternId: "cross_server_tool_redirect",
          patternName: `Tool "${tool.name}" on ${server.name} instructs the model to call ${other.server}'s "${other.tool.name}"`,
          category: "shadowing",
          severity: "high",
          owasp: "MCP03:2025",
          recommendation:
            "A tool description should describe that tool. Instructions that steer the model onto a tool owned by a different server are a cross-server poisoning path.",
          server: server.name,
          file,
          line: 1,
          column: 1,
          match: `${tool.name} -> ${other.server}.${other.tool.name}`,
        });
      }
    }
  }

  return findings;
}

const CONFUSABLES: Record<string, string> = {
  "\u0430": "a",
  "\u0435": "e",
  "\u043e": "o",
  "\u0440": "p",
  "\u0441": "c",
  "\u0443": "y",
  "\u0445": "x",
  "\u0456": "i",
  "\u0455": "s",
  "0": "o",
  "1": "l",
};

function normalizeName(name: string): string {
  let out = "";
  for (const ch of name.toLowerCase()) out += CONFUSABLES[ch] ?? ch;
  return out;
}

function confusable(a: string, b: string): boolean {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (left === right) return a.toLowerCase() !== b.toLowerCase();
  return left.length >= 4 && levenshteinLimited(left, right) === 1;
}

function levenshteinLimited(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > 1) return 2;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length] > 1 ? 2 : prev[b.length];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
