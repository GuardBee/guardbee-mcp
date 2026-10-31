import { scanText as oauthScan } from "@guardbee/mcp-oauth-auditor";
import { scanText as secretScan } from "@guardbee/mcp-secret-scanner";
import { scanText as serverScan } from "@guardbee/mcp-server-auditor";
import { scanText as poisonScan } from "@guardbee/mcp-tool-poisoning-scanner";
import type { ArchiveFile } from "./archive.js";

/** A static finding in a package, reduced to what the index publishes: no code, no secret values. */
export interface CodeFinding {
  scanner: "tool-poisoning" | "server-auditor" | "oauth-auditor" | "secret-scanner";
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  file: string;
  line: number;
}

/** Files a package ships that are not the server: bundled third-party code is scanned by its own package. */
const MAX_TEXT = 512 * 1024;

export function scanFiles(files: ArchiveFile[]): CodeFinding[] {
  const out: CodeFinding[] = [];
  for (const file of files) {
    if (file.data.length > MAX_TEXT || file.data.includes(0)) continue;
    const text = file.data.toString("utf8");
    // Minified bundles: one huge line is not reviewable and the regex scanners are tuned for source
    if (text.length > 20_000 && text.split("\n").length < 5) continue;
    const add = (scanner: CodeFinding["scanner"], findings: { patternId: string; severity: string; line: number }[]) => {
      for (const f of findings) out.push({ scanner, id: f.patternId, severity: f.severity as CodeFinding["severity"], file: file.path, line: f.line });
    };
    add("tool-poisoning", poisonScan(text, file.path));
    add("server-auditor", serverScan(text, file.path));
    add("oauth-auditor", oauthScan(text, file.path));
    add("secret-scanner", secretScan(text, file.path));
  }
  return out;
}
