import type { GatewayConfig, TableRule } from "../config";
import { maskRows, maskRow, findProtectedWriteFields } from "./masker";
import { AuditLogger, createAuditEvent, type AuditEvent, type AuditQueryFilter } from "../audit/logger";
import { RateLimiter } from "../rate-limiter";
import { RoleResolver, type WriteOperation } from "../rbac";

export type { AuditEvent, AuditQueryFilter };

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

export type WriteAuthorization =
  | { allowed: true; tableRule: TableRule | undefined }
  | DeniedResult;

export type WriteResult = {
  rowsAffected: number;
  /** insert için eklenen satır (maskelenmiş) */
  row?: Record<string, unknown>;
  auditId: string;
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

  /** `query_audit_log` tool'u için — bellek-içi audit event geçmişini filtreler. */
  queryAuditLog(filter: AuditQueryFilter = {}): AuditEvent[] {
    return this.audit.query(filter);
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

  /**
   * Bir write operasyonuna (insert/update/delete) izin var mı kontrol eder.
   * DB'ye HİÇ dokunmaz — bu bilerek böyle: bir tablonun erişimi tamamen
   * reddedilmişken bile "kaç satır etkilenir" diye önceden sorgu atmak,
   * erişim kontrolünü delmek anlamına gelirdi. Etkilenen satır sayısı
   * kontrolü ayrı bir adımdır, bkz. `checkAffectedRows` — çağıran taraf
   * sadece bu metot `allowed: true` döndürdükten SONRA update/delete için
   * bir count sorgusu atmalı.
   *
   * Reddedilirse audit log'a "denied" olarak yazar ve DeniedResult döner.
   *
   * Kontrol sırası:
   *   1. Global writesEnabled kill-switch
   *   2. Global tablo erişimi (tableRules deny)
   *   3. RBAC tablo kontrolü
   *   4. RBAC write izni (tablo write VE rol write — AND)
   *   5. Write rate limit (global + per-table, read limitinden ayrı)
   *   6. Field-level koruma — data içindeki korumalı (redact/mask/hash) alanlar
   *   7. update/delete için boş filtre yasağı
   */
  async authorizeWrite(
    tool: string,
    table: string,
    operation: WriteOperation,
    filter: Record<string, unknown> | undefined,
    data: Record<string, unknown> | undefined
  ): Promise<WriteAuthorization> {
    const started = Date.now();
    const params = this.writeParams(filter, data);

    const deny = (reason: string, retryAfterMs?: number) =>
      this.logDenied(tool, table, params, started, reason, operation).then((auditId) => ({
        denied: true as const,
        reason,
        auditId,
        ...(retryAfterMs ? { retryAfterMs } : {}),
      }));

    if (!this.config.writesEnabled) {
      return deny("Writes are disabled by gateway policy (writesEnabled=false).");
    }

    const tableRule = this.config.tableRules.find((r) => r.table === table);
    if (tableRule?.access === "deny") {
      return deny(`Access to table '${table}' is denied by gateway policy.`);
    }

    const roleAccess = this.roleResolver.checkTableAccess(table);
    if (!roleAccess.allowed) {
      return deny(roleAccess.reason);
    }

    const writeAccess = this.roleResolver.checkWriteAccess(tableRule, operation);
    if (!writeAccess.allowed) {
      return deny(writeAccess.reason);
    }

    const globalCheck = this.rateLimiter.check("write-global");
    if (!globalCheck.allowed) {
      return deny("Global write rate limit exceeded.", globalCheck.retryAfterMs);
    }

    const tableCheck = this.rateLimiter.check(`write-table:${table}`);
    if (!tableCheck.allowed) {
      return deny(`Write rate limit exceeded for table '${table}'.`, tableCheck.retryAfterMs);
    }

    if (data) {
      const protectedFields = findProtectedWriteFields(data, this.roleResolver.mergedFieldRules, table);
      if (protectedFields.length > 0) {
        return deny(`Cannot write to protected field(s): ${protectedFields.join(", ")}.`);
      }
    }

    if (operation !== "insert" && (!filter || Object.keys(filter).length === 0)) {
      return deny(`${operation} requires a non-empty filter — refusing to ${operation} an entire table.`);
    }

    return { allowed: true, tableRule };
  }

  /**
   * `authorizeWrite` onayladıktan SONRA, update/delete için çağrılır.
   * Çağıran taraf filtreyle `db.query(table, filter, maxAffectedRowsPerWrite + 1)`
   * çalıştırıp bulduğu satır sayısını (`matchedRowCount`) geçirir. Bu, yanlışlıkla
   * çok geniş bir filtreyle tüm tabloyu güncelleme/silmeye karşı asıl güvenlik ağıdır.
   */
  async checkAffectedRows(
    tool: string,
    table: string,
    operation: WriteOperation,
    filter: Record<string, unknown> | undefined,
    data: Record<string, unknown> | undefined,
    matchedRowCount: number
  ): Promise<{ allowed: true } | DeniedResult> {
    const maxAffected = this.config.maxAffectedRowsPerWrite;
    if (matchedRowCount <= maxAffected) return { allowed: true };

    const started = Date.now();
    const reason = `Refusing to ${operation} ${matchedRowCount} row(s) — exceeds maxAffectedRowsPerWrite (${maxAffected}). Narrow your filter.`;
    const auditId = await this.logDenied(tool, table, this.writeParams(filter, data), started, reason, operation);
    return { denied: true, reason, auditId };
  }

  private writeParams(
    filter: Record<string, unknown> | undefined,
    data: Record<string, unknown> | undefined
  ): Record<string, unknown> {
    return {
      ...(filter ? { filter } : {}),
      ...(data ? { fields: Object.keys(data) } : {}),
    };
  }

  /**
   * Bir write operasyonu gerçekleştirildikten SONRA çağrılır — sonucu audit
   * log'a yazar ve (varsa) eklenen satırı maskeleyerek döner.
   */
  async recordWrite(
    tool: string,
    table: string,
    operation: WriteOperation,
    filter: Record<string, unknown> | undefined,
    data: Record<string, unknown> | undefined,
    rowsAffected: number,
    insertedRow: Record<string, unknown> | undefined,
    startedAt: number
  ): Promise<WriteResult> {
    const event = createAuditEvent({
      tool,
      table,
      params: this.writeParams(filter, data),
      rowsReturned: rowsAffected,
      truncated: false,
      fieldsRedacted: [],
      durationMs: Date.now() - startedAt,
      operation,
      fieldsWritten: data ? Object.keys(data) : undefined,
    });
    await this.audit.log(event);

    return {
      rowsAffected,
      row: insertedRow ? maskRow(insertedRow, this.roleResolver.mergedFieldRules, table) : undefined,
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
    reason: string,
    operation?: WriteOperation
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
      ...(operation ? { operation } : {}),
    });
    await this.audit.log(event);
    return event.id;
  }
}
