/** Package names a one-character misspelling is compared against. Exact matches are not findings. */
export const KNOWN_MCP_PACKAGES: readonly string[] = [
  "@modelcontextprotocol/server-filesystem",
  "@modelcontextprotocol/server-github",
  "@modelcontextprotocol/server-gitlab",
  "@modelcontextprotocol/server-postgres",
  "@modelcontextprotocol/server-slack",
  "@modelcontextprotocol/server-memory",
  "@modelcontextprotocol/server-brave-search",
  "@modelcontextprotocol/server-puppeteer",
  "@modelcontextprotocol/server-everything",
  "@modelcontextprotocol/server-google-maps",
  "@modelcontextprotocol/server-sequential-thinking",
  "@modelcontextprotocol/server-fetch",
  "@modelcontextprotocol/server-sqlite",
  "@modelcontextprotocol/server-sentry",
  "mcp-server-github",
  "mcp-server-filesystem",
  "mcp-server-postgres",
  "mcp-server-slack",
  "mcp-server-memory",
  "mcp-server-fetch",
];

const KNOWN = new Set(KNOWN_MCP_PACKAGES.map((name) => name.toLowerCase()));

/** Distance above 1 is irrelevant for typosquat detection, so longer edits return 2. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
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

export interface TyposquatMatch {
  packageName: string;
  resembles: string;
}

/**
 * A package is a typosquat when its name, or its final path segment, is one
 * edit away from a known MCP package and is not itself that package.
 */
export function findTyposquat(packageName: string): TyposquatMatch | null {
  const name = packageName.toLowerCase();
  if (KNOWN.has(name)) return null;
  if (name.length < 8) return null;

  const base = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
  let closest: TyposquatMatch | null = null;

  for (const known of KNOWN_MCP_PACKAGES) {
    const knownLower = known.toLowerCase();
    if (levenshtein(name, knownLower) === 1) {
      return { packageName, resembles: known };
    }
    const knownBase = knownLower.includes("/") ? knownLower.slice(knownLower.lastIndexOf("/") + 1) : knownLower;
    if (base.length >= 8 && base !== knownBase && levenshtein(base, knownBase) === 1) {
      closest = { packageName, resembles: known };
    }
  }
  return closest;
}
