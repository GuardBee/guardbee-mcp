import { scanDirectory as scanSecrets, scanFile as secretScanFile } from "@guardbee/mcp-secret-scanner";
import { scanDirectory as scanServer, scanFile as serverScanFile } from "@guardbee/mcp-server-auditor";
import { scanDirectory as scanOAuth, scanFile as oauthScanFile } from "@guardbee/mcp-oauth-auditor";
import { scanDirectory as scanAuditGap, scanFile as auditScanFile } from "@guardbee/mcp-audit-gap-auditor";
import { scanDirectory as scanContext, scanFile as contextScanFile } from "@guardbee/mcp-context-oversharing-auditor";
import {
  scanDirectory as scanToxicDir,
  scanSourceFile as toxicScanFile,
  auditCatalog,
  parseToolsJson,
} from "@guardbee/mcp-toxic-flow-auditor";
import { scanDirectory as scanPoisonDir, scanFile as poisonScanFile, scanToolCatalog } from "@guardbee/mcp-tool-poisoning-scanner";
import { discoverShadowMcp, loadAllowlistFile, type Allowlist } from "@guardbee/mcp-config-auditor";
import { statSync, readFileSync } from "fs";
import { gradeFromFindings } from "./grade.js";
import { OWASP_TITLES, resolveOwasp } from "./owaspMap.js";
import { connectAndListTools } from "./mcpClient.js";
import type {
  ConnectionTarget,
  NormalizedFinding,
  OwaspBucket,
  OwaspId,
  OwaspReport,
  Severity,
} from "./types.js";

function normalize(
  partial: {
    patternId: string;
    patternName: string;
    severity: string;
    owasp?: string;
    recommendation?: string;
    file?: string;
    line?: number;
    column?: number;
    match: string;
    tools?: string[];
  },
  source: string
): NormalizedFinding | null {
  const owasp = resolveOwasp(partial.owasp, partial.patternId, source);
  if (!owasp) return null;
  return {
    patternId: partial.patternId,
    patternName: partial.patternName,
    severity: partial.severity as Severity,
    owasp,
    source,
    recommendation: partial.recommendation ?? `See ${source} / ${partial.patternId}`,
    file: partial.file,
    line: partial.line,
    column: partial.column,
    match: partial.match,
    tools: partial.tools,
  };
}

function bucketize(findings: NormalizedFinding[]): OwaspBucket[] {
  const ids = Object.keys(OWASP_TITLES) as OwaspId[];
  return ids.map((id) => {
    const items = findings.filter((f) => f.owasp === id);
    return { id, title: OWASP_TITLES[id], findingCount: items.length, findings: items };
  });
}

function buildReport(
  mode: OwaspReport["mode"],
  label: string,
  findings: NormalizedFinding[],
  start: number,
  extras: Partial<OwaspReport> = {}
): OwaspReport {
  const { grade, score } = gradeFromFindings(findings);
  return {
    mode,
    grade,
    score,
    totalFindings: findings.length,
    byOwasp: bucketize(findings),
    findings,
    durationMs: Date.now() - start,
    label,
    ...extras,
  };
}

export interface PathScanOptions {
  maxFiles?: number;
  exclude?: string[];
  /** Path to Shadow MCP allowlist (JSON/YAML). Used when discoverShadow is true. */
  allowlistPath?: string;
  /** Also walk host MCP client configs for Shadow MCP (MCP09). Default false. */
  discoverShadow?: boolean;
}

function pushNormalized(findings: NormalizedFinding[], items: Array<Parameters<typeof normalize>[0]>, source: string) {
  for (const item of items) {
    const n = normalize(item, source);
    if (n) findings.push(n);
  }
}

export function scanPath(targetPath: string, options: PathScanOptions = {}): OwaspReport {
  const start = Date.now();
  const maxFiles = options.maxFiles ?? 5000;
  const exclude = options.exclude;
  const findings: NormalizedFinding[] = [];
  let scannedFiles = 0;

  const stat = statSync(targetPath);
  if (!stat.isDirectory() && !stat.isFile()) {
    throw new Error(`Path is neither file nor directory: ${targetPath}`);
  }

  if (stat.isFile()) {
    const report = scanSingleFile(targetPath, start);
    if (options.discoverShadow) {
      report.findings.push(...runDiscover(options.allowlistPath));
      report.totalFindings = report.findings.length;
      report.byOwasp = bucketize(report.findings);
      const graded = gradeFromFindings(report.findings);
      report.grade = graded.grade;
      report.score = graded.score;
    }
    return report;
  }

  const dirOpts = { maxFiles, exclude };

  const secrets = scanSecrets(targetPath, dirOpts);
  scannedFiles = Math.max(scannedFiles, secrets.scannedFiles);
  pushNormalized(
    findings,
    secrets.findings.map((f) => ({
      patternId: f.patternId,
      patternName: f.patternName,
      severity: f.severity,
      recommendation: "Remove or rotate the leaked credential; load secrets from a vault/env at runtime.",
      file: f.file,
      line: f.line,
      column: f.column,
      match: f.match,
    })),
    "secret-scanner"
  );

  const server = scanServer(targetPath, dirOpts);
  scannedFiles = Math.max(scannedFiles, server.scannedFiles);
  pushNormalized(
    findings,
    server.findings.map((f) => ({
      patternId: f.patternId,
      patternName: f.patternName,
      severity: f.severity,
      owasp: f.owasp,
      recommendation: f.recommendation,
      file: f.file,
      line: f.line,
      column: f.column,
      match: f.match,
    })),
    "mcp-server-auditor"
  );

  const oauth = scanOAuth(targetPath, dirOpts);
  scannedFiles = Math.max(scannedFiles, oauth.scannedFiles);
  pushNormalized(
    findings,
    oauth.findings.map((f) => ({
      patternId: f.patternId,
      patternName: f.patternName,
      severity: f.severity,
      recommendation: f.recommendation,
      file: f.file,
      line: f.line,
      column: f.column,
      match: f.match,
    })),
    "oauth-auditor"
  );

  const audit = scanAuditGap(targetPath, dirOpts);
  scannedFiles = Math.max(scannedFiles, audit.scannedFiles);
  pushNormalized(
    findings,
    audit.findings.map((f) => ({
      patternId: f.patternId,
      patternName: f.patternName,
      severity: f.severity,
      owasp: f.owasp,
      recommendation: f.recommendation,
      file: f.file,
      line: f.line,
      column: f.column,
      match: f.match,
    })),
    "audit-gap"
  );

  const ctx = scanContext(targetPath, dirOpts);
  scannedFiles = Math.max(scannedFiles, ctx.scannedFiles);
  pushNormalized(
    findings,
    ctx.findings.map((f) => ({
      patternId: f.patternId,
      patternName: f.patternName,
      severity: f.severity,
      owasp: f.owasp,
      recommendation: f.recommendation,
      file: f.file,
      line: f.line,
      column: f.column,
      match: f.match,
    })),
    "context-oversharing"
  );

  const toxic = scanToxicDir(targetPath, dirOpts);
  pushNormalized(
    findings,
    toxic.findings.map((f) => ({
      patternId: f.patternId,
      patternName: f.patternName,
      severity: f.severity,
      owasp: f.owasp,
      recommendation: f.recommendation,
      match: f.match,
      tools: f.tools,
    })),
    "toxic-flow"
  );

  const poison = scanPoisonDir(targetPath, dirOpts);
  scannedFiles = Math.max(scannedFiles, poison.scannedFiles);
  pushNormalized(
    findings,
    poison.findings.map((f) => ({
      patternId: f.patternId,
      patternName: f.patternName,
      severity: f.severity,
      owasp: f.owasp,
      recommendation: f.recommendation,
      file: f.file,
      line: f.line,
      column: f.column,
      match: f.match,
    })),
    "tool-poisoning"
  );

  if (options.discoverShadow) {
    findings.push(...runDiscover(options.allowlistPath));
  }

  return buildReport("path", targetPath, findings, start, { scannedFiles });
}

function scanSingleFile(filePath: string, start: number): OwaspReport {
  const findings: NormalizedFinding[] = [];

  pushNormalized(
    findings,
    secretScanFile(filePath).findings.map((f) => ({
      patternId: f.patternId,
      patternName: f.patternName,
      severity: f.severity,
      recommendation: "Remove or rotate the leaked credential; load secrets from a vault/env at runtime.",
      file: f.file,
      line: f.line,
      column: f.column,
      match: f.match,
    })),
    "secret-scanner"
  );
  pushNormalized(
    findings,
    serverScanFile(filePath).findings.map((f) => ({
      patternId: f.patternId,
      patternName: f.patternName,
      severity: f.severity,
      owasp: f.owasp,
      recommendation: f.recommendation,
      file: f.file,
      line: f.line,
      column: f.column,
      match: f.match,
    })),
    "mcp-server-auditor"
  );
  pushNormalized(
    findings,
    oauthScanFile(filePath).findings.map((f) => ({
      patternId: f.patternId,
      patternName: f.patternName,
      severity: f.severity,
      recommendation: f.recommendation,
      file: f.file,
      line: f.line,
      column: f.column,
      match: f.match,
    })),
    "oauth-auditor"
  );
  pushNormalized(
    findings,
    auditScanFile(filePath).findings.map((f) => ({
      patternId: f.patternId,
      patternName: f.patternName,
      severity: f.severity,
      owasp: f.owasp,
      recommendation: f.recommendation,
      file: f.file,
      line: f.line,
      column: f.column,
      match: f.match,
    })),
    "audit-gap"
  );
  pushNormalized(
    findings,
    contextScanFile(filePath).findings.map((f) => ({
      patternId: f.patternId,
      patternName: f.patternName,
      severity: f.severity,
      owasp: f.owasp,
      recommendation: f.recommendation,
      file: f.file,
      line: f.line,
      column: f.column,
      match: f.match,
    })),
    "context-oversharing"
  );
  pushNormalized(
    findings,
    poisonScanFile(filePath).findings.map((f) => ({
      patternId: f.patternId,
      patternName: f.patternName,
      severity: f.severity,
      owasp: f.owasp,
      recommendation: f.recommendation,
      file: f.file,
      line: f.line,
      column: f.column,
      match: f.match,
    })),
    "tool-poisoning"
  );

  const toxic = toxicScanFile(filePath);
  if (!toxic.skipped) {
    pushNormalized(
      findings,
      toxic.result.findings.map((f) => ({
        patternId: f.patternId,
        patternName: f.patternName,
        severity: f.severity,
        owasp: f.owasp,
        recommendation: f.recommendation,
        match: f.match,
        tools: f.tools,
      })),
      "toxic-flow"
    );
  }

  return buildReport("path", filePath, findings, start, { scannedFiles: 1 });
}

function runDiscover(allowlistPath?: string): NormalizedFinding[] {
  let allowlist: Allowlist | null = null;
  if (allowlistPath) {
    allowlist = loadAllowlistFile(allowlistPath);
  }
  const result = discoverShadowMcp({ allowlist });
  const out: NormalizedFinding[] = [];
  pushNormalized(
    out,
    result.findings.map((f) => ({
      patternId: f.patternId,
      patternName: f.patternName,
      severity: f.severity,
      owasp: f.owasp,
      recommendation: f.recommendation,
      file: f.file,
      line: f.line,
      column: f.column,
      match: f.match,
    })),
    "config-discover"
  );
  return out;
}

export function scanCatalogJson(raw: string, label = "catalog"): OwaspReport {
  const start = Date.now();
  const tools = parseToolsJson(raw);
  const findings: NormalizedFinding[] = [];

  const toxic = auditCatalog(tools, label);
  pushNormalized(
    findings,
    toxic.findings.map((f) => ({
      patternId: f.patternId,
      patternName: f.patternName,
      severity: f.severity,
      owasp: f.owasp,
      recommendation: f.recommendation,
      match: f.match,
      tools: f.tools,
    })),
    "toxic-flow"
  );

  const poison = scanToolCatalog(
    tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }))
  );
  pushNormalized(
    findings,
    poison.map((f) => ({
      patternId: f.patternId,
      patternName: f.patternName,
      severity: f.severity,
      owasp: f.owasp,
      recommendation: f.recommendation,
      match: f.match,
      tools: [f.toolName],
    })),
    "tool-poisoning"
  );

  return buildReport("catalog", label, findings, start, { toolCount: tools.length });
}

export async function scanLive(target: ConnectionTarget, timeoutMs = 15000): Promise<OwaspReport> {
  const start = Date.now();
  const live = await connectAndListTools(target, timeoutMs);
  const label =
    target.type === "http"
      ? target.url
      : [target.command, ...(target.args ?? [])].join(" ");

  const toolsJson = JSON.stringify({
    tools: live.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  });

  const report = scanCatalogJson(toolsJson, label);
  report.mode = "live";
  report.toolCount = live.tools.length;
  report.durationMs = Date.now() - start;
  if (live.serverInfo) {
    report.label = `${live.serverInfo.name}@${live.serverInfo.version} (${label})`;
  }
  return report;
}

export function scanCatalogFile(path: string): OwaspReport {
  return scanCatalogJson(readFileSync(path, "utf8"), path);
}
