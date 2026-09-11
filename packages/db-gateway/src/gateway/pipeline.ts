import type { GatewayConfig } from "../config";
import { maskRows } from "./masker";
import { AuditLogger, createAuditEvent } from "../audit/logger";
import { RateLimiter } from "../rate-limiter";
import { RoleResolver } from "../rbac";

export type QueryResult = {
  rows: Record<string, unknown>[];
  truncated: boolean;
  totalBeforeTruncation: number;
  auditId: string;
};

export type DeniedResult = {
  denied: true;
  reason: string;
  auditId: string;
  retryAfterMs?: number;
};

export class GatewayPipeline {
  private readonly audit: AuditLogger;
  private readonly rateLimiter: RateLimiter;
  private readonly roleResolver: RoleResolver;

  constructor(private readonly config: GatewayConfig) {
    this.audit = new AuditLogger(config.audit);
    this.rateLimiter = new RateLimiter(config.rateLimit);
    this.roleResolver = new RoleResolver(config);
  }

  /** list_tables için tablo listesini rol kısıtlamalarına göre filtreler. */
  filterTables(tables: string[]): string[] {
    return this.roleResolver.filterTables(tables);
  }

  /** Aktif rol adını döner (gateway_status için). */
  get activeRoleName(): string | null {
    return this.roleResolver.role?.name ?? null;
  }

  /**
   * Veriyi gateway üzerinden geçirir:
   *   1. Global tablo erişim kontrolü (tableRules deny)
   *   2. RBAC tablo kontrolü (rol allowTables / denyTables)
   *   3. Rate limit kontrolü (global + per-table)
   *   4. PII / field maskeleme (rol + global kurallar)
   *   5. Row sayısı limiti (rol override dâhil)
   *   6. Audit log
   */
  async process(
    tool: string,
    table: string,
    params: Record<string, unknown>,
    rawRows: Record<string, unknown>[]
  ): Promise<QueryResult | DeniedResult> {
    const started = Date.now();

    // 1. Global tablo erişim kontrolü
    const tableRule = this.config.tableRules.find((r) => r.table === table);
    if (tableRule?.access === "deny") {
      const auditId = await this.logDenied(tool, table, params, started, "Table access denied by policy");
      return { denied: true, reason: `Access to table '${table}' is denied by gateway policy.`, auditId };
    }

    // 2. RBAC tablo kontrolü
    const roleAccess = this.roleResolver.checkTableAccess(table);
    if (!roleAccess.allowed) {
      const auditId = await this.logDenied(tool, table, params, started, roleAccess.reason);
      return { denied: true, reason: roleAccess.reason, auditId };
    }

    // 3. Rate limit kontrolü
    const globalCheck = this.rateLimiter.check("global");
    if (!globalCheck.allowed) {
      const auditId = await this.logDenied(tool, table, params, started, "Global rate limit exceeded");
      return {
        denied: true,
        reason: `Rate limit exceeded. Too many requests in the current window.`,
        retryAfterMs: globalCheck.retryAfterMs,
        auditId,
      };
    }

    const tableCheck = this.rateLimiter.check(`table:${table}`);
    if (!tableCheck.allowed) {
      const auditId = await this.logDenied(tool, table, params, started, `Per-table rate limit exceeded: ${table}`);
      return {
        denied: true,
        reason: `Rate limit exceeded for table '${table}'. Too many queries in the current window.`,
        retryAfterMs: tableCheck.retryAfterMs,
        auditId,
      };
    }

    // 4 & 5. Maskeleme + row limiti (rol kuralları dahil)
    const maxRows = this.roleResolver.effectiveMaxRows(tableRule?.maxRows);
    const { rows, truncated } = maskRows(
      rawRows,
      this.roleResolver.mergedFieldRules,
      table,
      maxRows
    );

    // 6a. Hangi field'lar maskelendi?
    const redactedFields = this.detectRedactedFields(rawRows[0] ?? {}, rows[0] ?? {});

    // 6b. Audit log
    const event = createAuditEvent({
      tool,
      table,
      params,
      rowsReturned: rows.length,
      truncated,
      fieldsRedacted: redactedFields,
      durationMs: Date.now() - started,
    });
    await this.audit.log(event);

    return {
      rows,
      truncated,
      totalBeforeTruncation: rawRows.length,
      auditId: event.id,
    };
  }

  private detectRedactedFields(
    original: Record<string, unknown>,
    masked: Record<string, unknown>
  ): string[] {
    return Object.keys(original).filter(
      (k) => original[k] !== masked[k]
    );
  }

  private async logDenied(
    tool: string,
    table: string,
    params: Record<string, unknown>,
    started: number,
    reason: string
  ): Promise<string> {
    const event = createAuditEvent({
      tool,
      table,
      params,
      rowsReturned: 0,
      truncated: false,
      fieldsRedacted: [],
      durationMs: Date.now() - started,
      denied: true,
      denyReason: reason,
    });
    await this.audit.log(event);
    return event.id;
  }
}
