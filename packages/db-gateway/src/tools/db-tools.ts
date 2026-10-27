import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GatewayConfig } from "../config";
import type { DbAdapter } from "../types";
import { GatewayPipeline } from "../gateway/pipeline";

function formatDenied(result: { reason: string; auditId: string; retryAfterMs?: number }): string {
  return JSON.stringify(
    {
      error: result.reason,
      auditId: result.auditId,
      ...(result.retryAfterMs ? { retryAfterMs: result.retryAfterMs } : {}),
    },
    null,
    2
  );
}

function formatResult(result: Awaited<ReturnType<GatewayPipeline["process"]>>): string {
  if ("denied" in result) {
    return formatDenied(result);
  }
  return JSON.stringify(
    {
      rows: result.rows,
      meta: {
        count: result.rows.length,
        truncated: result.truncated,
        totalBeforeTruncation: result.totalBeforeTruncation,
        auditId: result.auditId,
        note: result.truncated
          ? `Results limited to ${result.rows.length} rows by gateway policy.`
          : undefined,
      },
    },
    null,
    2
  );
}

/** Global deny and role allow/deny, matching list_tables. Null when the table may be described. */
export function describeTableAccessError(
  config: GatewayConfig,
  pipeline: GatewayPipeline,
  table: string,
): string | null {
  const tableRule = config.tableRules.find((r) => r.table === table);
  if (tableRule?.access === "deny") return `Table '${table}' is not accessible.`;
  if (!pipeline.filterTables([table]).includes(table)) return `Table '${table}' is not accessible.`;
  return null;
}

export function registerDbTools(
  server: McpServer,
  config: GatewayConfig,
  db: DbAdapter,
  pipeline: GatewayPipeline
): void {
  // ─── Tool 1: query_table ──────────────────────────────────────────────────
  server.registerTool(
    "query_table",
    {
      description: "Query rows from a database table with optional filters. All results pass through the KVKK/GDPR gateway — sensitive fields are automatically masked.",
      inputSchema: {
        table: z.string().describe("Table name to query"),
        filter: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Key-value filter pairs, e.g. { status: 'active' }"),
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe("Max rows to fetch before gateway limit is applied (default 50)"),
      },
    },
    async ({ table, filter = {}, limit = 50 }) => {
      const rawRows = await db.query(table, filter, limit);
      const result = await pipeline.process("query_table", table, { filter, limit }, rawRows);
      return { content: [{ type: "text", text: formatResult(result) }] };
    }
  );

  // ─── Tool 2: list_tables ─────────────────────────────────────────────────
  server.registerTool(
    "list_tables",
    {
      description: "List all available database tables. Tables marked as 'deny' in gateway policy are omitted.",
      inputSchema: {},
    },
    async () => {
      const allTables = await db.tables();
      // Global deny kuralları
      const globalDenied = new Set(
        config.tableRules.filter((r) => r.access === "deny").map((r) => r.table)
      );
      const afterGlobal = allTables.filter((t) => !globalDenied.has(t));
      // RBAC rol filtresi
      const visible = pipeline.filterTables(afterGlobal);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { tables: visible, hiddenByPolicy: allTables.length - visible.length },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ─── Tool 3: describe_table ───────────────────────────────────────────────
  server.registerTool(
    "describe_table",
    {
      description: "Get the column names and gateway masking policy for a table — helps the LLM understand what data it can access.",
      inputSchema: { table: z.string().describe("Table name") },
    },
    async ({ table }) => {
      const denied = describeTableAccessError(config, pipeline, table);
      if (denied) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: denied }) }],
        };
      }
      const tableRule = config.tableRules.find((r) => r.table === table);

      // Sample 1 row to infer schema + show masking policy
      const sampleRows = await db.query(table, {}, 1);
      if (sampleRows.length === 0) {
        return {
          content: [{ type: "text", text: JSON.stringify({ table, columns: [], note: "Table is empty." }) }],
        };
      }

      const columns = Object.keys(sampleRows[0]).map((col) => {
        const rule = config.fieldRules.find((r) => r.field === col || r.field === `*${col}*`);
        return { name: col, gatewayPolicy: rule?.strategy ?? "allow" };
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { table, columns, maxRowsPerQuery: tableRule?.maxRows ?? config.defaultMaxRows },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ─── Tool 4: query_audit_log ───────────────────────────────────────────────
  server.registerTool(
    "query_audit_log",
    {
      description: "Query the gateway's own audit log — inspect which tools were called, on which tables, whether they were allowed or denied (and why), and which fields were redacted/written. Covers events since this server process started; count is capped by the gateway's audit.bufferSize (default 200).",
      inputSchema: {
        table: z.string().optional().describe("Filter by table name"),
        tool: z.string().optional().describe("Filter by MCP tool name, e.g. 'query_table', 'update_row'"),
        operation: z
          .enum(["read", "insert", "update", "delete"])
          .optional()
          .describe("Filter by operation type"),
        deniedOnly: z.boolean().optional().describe("Only return calls the gateway denied/blocked"),
        since: z.string().optional().describe("ISO 8601 timestamp — only events at or after this time"),
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe("Max events to return, most recent first (default 50)"),
      },
    },
    async ({ table, tool, operation, deniedOnly, since, limit }) => {
      if (!config.audit.enabled) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: "Audit logging is disabled (audit.enabled=false) — nothing to query." }),
            },
          ],
        };
      }

      const events = pipeline.queryAuditLog({ table, tool, operation, deniedOnly, since, limit });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                events,
                count: events.length,
                bufferSize: config.audit.bufferSize,
                note: "In-memory only — resets when the gateway process restarts.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ─── Tool 5: gateway_status ───────────────────────────────────────────────
  server.registerTool(
    "gateway_status",
    {
      description: "Show the active gateway configuration: field masking rules, table policies, and audit settings.",
      inputSchema: {},
    },
    async () => {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                serverName: config.serverName,
                activeRole: pipeline.activeRoleName ?? "none",
                fieldRulesCount: config.fieldRules.length,
                tableRulesCount: config.tableRules.length,
                rolesCount: config.roles.length,
                defaultMaxRows: config.defaultMaxRows,
                writesEnabled: config.writesEnabled,
                maxAffectedRowsPerWrite: config.maxAffectedRowsPerWrite,
                auditEnabled: config.audit.enabled,
                auditSink: config.audit.sink,
                auditBufferSize: config.audit.bufferSize,
                rateLimit: config.rateLimit,
                fieldRules: config.fieldRules,
                tableRules: config.tableRules,
                roles: config.roles,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}

/**
 * insert_row / update_row / delete_row tool'larını register eder.
 * `config.writesEnabled` false ise (default) hiçbir şey yapmaz — bu tool'lar
 * client'a hiç görünmez, sadece "izin reddedildi" dönmez.
 */
export function registerWriteTools(
  server: McpServer,
  config: GatewayConfig,
  db: DbAdapter,
  pipeline: GatewayPipeline
): void {
  if (!config.writesEnabled) return;

  // ─── Tool: insert_row ──────────────────────────────────────────────────────
  server.registerTool(
    "insert_row",
    {
      description: "Insert a new row into a database table. Only works for tables/roles explicitly granted insert access, and never for fields protected by a PII masking rule (e.g. tcKimlik, passwordHash).",
      inputSchema: {
        table: z.string().describe("Table name to insert into"),
        data: z.record(z.string(), z.unknown()).describe("Column values for the new row, e.g. { name: 'Acme', status: 'active' }"),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ table, data }) => {
      if (!db.insert) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "This adapter does not support insert." }) }] };
      }

      const started = Date.now();
      const auth = await pipeline.authorizeWrite("insert_row", table, "insert", undefined, data);
      if ("denied" in auth) {
        return { content: [{ type: "text", text: formatDenied(auth) }] };
      }

      const insertedRow = await db.insert(table, data);
      const result = await pipeline.recordWrite("insert_row", table, "insert", undefined, data, 1, insertedRow, started);
      return { content: [{ type: "text", text: JSON.stringify({ row: result.row, auditId: result.auditId }, null, 2) }] };
    }
  );

  // ─── Tool: update_row ──────────────────────────────────────────────────────
  server.registerTool(
    "update_row",
    {
      description: "Update rows matching a filter in a database table. Requires a non-empty filter — cannot update an entire table. Refuses to touch more than the gateway's maxAffectedRowsPerWrite limit; narrow your filter if that happens.",
      inputSchema: {
        table: z.string().describe("Table name"),
        filter: z.record(z.string(), z.unknown()).describe("Key-value filter identifying which rows to update — required, cannot be empty"),
        data: z.record(z.string(), z.unknown()).describe("Column values to set"),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ table, filter, data }) => {
      if (!db.update) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "This adapter does not support update." }) }] };
      }

      const started = Date.now();
      const auth = await pipeline.authorizeWrite("update_row", table, "update", filter, data);
      if ("denied" in auth) {
        return { content: [{ type: "text", text: formatDenied(auth) }] };
      }

      const maxAffected = config.maxAffectedRowsPerWrite;
      const matched = await db.query(table, filter, maxAffected + 1);
      const affectedCheck = await pipeline.checkAffectedRows("update_row", table, "update", filter, data, matched.length);
      if ("denied" in affectedCheck) {
        return { content: [{ type: "text", text: formatDenied(affectedCheck) }] };
      }

      const rowsAffected = await db.update(table, filter, data);
      const result = await pipeline.recordWrite("update_row", table, "update", filter, data, rowsAffected, undefined, started);
      return { content: [{ type: "text", text: JSON.stringify({ rowsAffected: result.rowsAffected, auditId: result.auditId }, null, 2) }] };
    }
  );

  // ─── Tool: delete_row ──────────────────────────────────────────────────────
  server.registerTool(
    "delete_row",
    {
      description: "Delete rows matching a filter from a database table. Requires a non-empty filter — cannot delete an entire table. Refuses to touch more than the gateway's maxAffectedRowsPerWrite limit; narrow your filter if that happens.",
      inputSchema: {
        table: z.string().describe("Table name"),
        filter: z.record(z.string(), z.unknown()).describe("Key-value filter identifying which rows to delete — required, cannot be empty"),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ table, filter }) => {
      if (!db.delete) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "This adapter does not support delete." }) }] };
      }

      const started = Date.now();
      const auth = await pipeline.authorizeWrite("delete_row", table, "delete", filter, undefined);
      if ("denied" in auth) {
        return { content: [{ type: "text", text: formatDenied(auth) }] };
      }

      const maxAffected = config.maxAffectedRowsPerWrite;
      const matched = await db.query(table, filter, maxAffected + 1);
      const affectedCheck = await pipeline.checkAffectedRows("delete_row", table, "delete", filter, undefined, matched.length);
      if ("denied" in affectedCheck) {
        return { content: [{ type: "text", text: formatDenied(affectedCheck) }] };
      }

      const rowsAffected = await db.delete(table, filter);
      const result = await pipeline.recordWrite("delete_row", table, "delete", filter, undefined, rowsAffected, undefined, started);
      return { content: [{ type: "text", text: JSON.stringify({ rowsAffected: result.rowsAffected, auditId: result.auditId }, null, 2) }] };
    }
  );
}
