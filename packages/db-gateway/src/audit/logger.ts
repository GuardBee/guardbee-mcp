import { appendFileSync } from "fs";
import type { AuditConfig } from "../config";

export type AuditEvent = {
  id: string;
  timestamp: string;
  tool: string;
  table: string;
  params: Record<string, unknown>;
  /** query için döndürülen, write için etkilenen (inserted/updated/deleted) satır sayısı. */
  rowsReturned: number;
  truncated: boolean;
  fieldsRedacted: string[];
  durationMs: number;
  denied?: boolean;
  denyReason?: string;
  /** Belirtilmezse "read" sayılır (geriye dönük uyumluluk). */
  operation?: "read" | "insert" | "update" | "delete";
  /** insert/update için yazılan alan adları (değerler değil — audit log'un kendisi bir PII sızıntı noktası olmasın diye). */
  fieldsWritten?: string[];
};

function generateId(): string {
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createAuditEvent(
  partial: Omit<AuditEvent, "id" | "timestamp">
): AuditEvent {
  return {
    id: generateId(),
    timestamp: new Date().toISOString(),
    ...partial,
  };
}

export type AuditQueryFilter = {
  table?: string;
  tool?: string;
  operation?: AuditEvent["operation"];
  /** true ise sadece denied=true olan event'leri döner */
  deniedOnly?: boolean;
  /** ISO 8601 — bu zamanda veya sonrasındaki event'ler */
  since?: string;
  /** En fazla kaç event döner, en yeniden en eskiye (default 50) */
  limit?: number;
};

export class AuditLogger {
  /**
   * Sink'ten (console/file/http) bağımsız, her zaman tutulan son N event —
   * `query_audit_log` tool'u buradan okur. Sink ne olursa olsun (webhook'a
   * fire-and-forget gönderilmiş olsa bile) sürecin kendi ömrü boyunca
   * sorgulanabilir bir geçmiş sağlar. Süreç yeniden başlarsa sıfırlanır.
   */
  private readonly buffer: AuditEvent[] = [];
  private readonly bufferSize: number;

  constructor(private readonly config: AuditConfig) {
    this.bufferSize = config.bufferSize ?? 200;
  }

  async log(event: AuditEvent): Promise<void> {
    if (!this.config.enabled) return;

    this.buffer.push(event);
    if (this.buffer.length > this.bufferSize) {
      this.buffer.shift();
    }

    const line = JSON.stringify(event);

    switch (this.config.sink) {
      case "console":
        console.error(`[AUDIT] ${line}`);
        break;

      case "file":
        if (!this.config.filePath) {
          console.error("[guardbee-gateway] audit.filePath not set, falling back to console");
          console.error(`[AUDIT] ${line}`);
          break;
        }
        appendFileSync(this.config.filePath, line + "\n", "utf8");
        break;

      case "http":
        if (!this.config.webhookUrl) {
          console.error("[guardbee-gateway] audit.webhookUrl not set");
          break;
        }
        try {
          await fetch(this.config.webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: line,
          });
        } catch (err) {
          console.error("[guardbee-gateway] audit webhook failed:", err);
        }
        break;
    }
  }

  /** Bellek-içi buffer'ı filtreler. En yeni event önce döner. */
  query(filter: AuditQueryFilter = {}): AuditEvent[] {
    const { table, tool, operation, deniedOnly, since, limit = 50 } = filter;
    const sinceMs = since ? new Date(since).getTime() : undefined;

    let results = this.buffer;
    if (table) results = results.filter((e) => e.table === table);
    if (tool) results = results.filter((e) => e.tool === tool);
    if (operation) results = results.filter((e) => (e.operation ?? "read") === operation);
    if (deniedOnly) results = results.filter((e) => e.denied === true);
    if (sinceMs !== undefined && !Number.isNaN(sinceMs)) {
      results = results.filter((e) => new Date(e.timestamp).getTime() >= sinceMs);
    }

    const capped = Math.max(1, Math.min(limit, this.bufferSize));
    return results.slice(-capped).reverse();
  }
}
