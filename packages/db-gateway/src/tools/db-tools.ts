import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GatewayConfig } from "../config";
import type { DbAdapter } from "../types";
import { GatewayPipeline } from "../gateway/pipeline";

function formatResult(result: Awaited<ReturnType<GatewayPipeline["process"]>>): string {
  if ("denied" in result) {
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

export function registerDbTools(
  server: McpServer,
  config: GatewayConfig,
  db: DbAdapter
): void {
  const pipeline = new GatewayPipeline(config);

  // ─── Tool 1: query_table ──────────────────────────────────────────────────
  server.tool(
    "query_table",
    "Query rows from a database table with optional filters. All results pass through the KVKK/GDPR gateway — sensitive fields are automatically masked.",
    {
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
    async ({ table, filter = {}, limit = 50 }) => {
      const rawRows = await db.query(table, filter, limit);
      const result = await pipeline.process("query_table", table, { filter, limit }, rawRows);
      return { content: [{ type: "text", text: formatResult(result) }] };
    }
  );

  // ─── Tool 2: list_tables ─────────────────────────────────────────────────
  server.tool(
    "list_tables",
    "List all available database tables. Tables marked as 'deny' in gateway policy are omitted.",
    {},
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
  server.tool(
    "describe_table",
    "Get the column names and gateway masking policy for a table — helps the LLM understand what data it can access.",
    { table: z.string().describe("Table name") },
    async ({ table }) => {
      const tableRule = config.tableRules.find((r) => r.table === table);
      if (tableRule?.access === "deny") {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Table '${table}' is not accessible.` }) }],
        };
      }

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

  // ─── Tool 4: gateway_status ───────────────────────────────────────────────
  server.tool(
    "gateway_status",
    "Show the active gateway configuration: field masking rules, table policies, and audit settings.",
    {},
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
                auditEnabled: config.audit.enabled,
                auditSink: config.audit.sink,
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
