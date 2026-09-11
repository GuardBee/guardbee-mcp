import { appendFileSync } from "fs";
import type { AuditConfig } from "../config";

export type AuditEvent = {
  id: string;
  timestamp: string;
  tool: string;
  table: string;
  params: Record<string, unknown>;
  rowsReturned: number;
  truncated: boolean;
  fieldsRedacted: string[];
  durationMs: number;
  denied?: boolean;
  denyReason?: string;
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

export class AuditLogger {
  constructor(private readonly config: AuditConfig) {}

  async log(event: AuditEvent): Promise<void> {
    if (!this.config.enabled) return;

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
}
