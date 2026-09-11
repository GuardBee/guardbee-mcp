import type { DbAdapter } from "../types";
import { assertValidIdentifier, assertPositiveInteger, quoteIdentifier } from "./sql-utils";

/** `mysql2/promise`'in Pool/PoolConnection tiplerinin ortak kesişimi. */
export type MysqlQueryable = {
  execute<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[]
  ): Promise<[T[], unknown]>;
};

export type MysqlAdapterOptions = {
  /** Sorgulanacak veritabanı adı. Belirtilmezse bağlantının aktif DB'si (`DATABASE()`) kullanılır. */
  database?: string;
};

/**
 * `mysql2/promise` Pool/Connection'ı kabul eder ve DbAdapter döner.
 *
 * Kullanım:
 * ```ts
 * import mysql from "mysql2/promise";
 * import { createServer, createMysqlAdapter } from "@guardbee/mcp-db-gateway";
 *
 * const pool = mysql.createPool(process.env.DATABASE_URL!);
 * const server = createServer({}, createMysqlAdapter(pool));
 * ```
 *
 * Güvenlik notu: tablo/kolon adları parametrize edilemediği için SQL'e
 * gömülmeden önce `information_schema` üzerinden canlı şemayla doğrulanır —
 * whitelist'te olmayan bir tablo/kolon adı reddedilir.
 */
export function createMysqlAdapter(pool: MysqlQueryable, options: MysqlAdapterOptions = {}): DbAdapter {
  const schemaExpr = options.database ? "?" : "DATABASE()";
  const schemaParams = options.database ? [options.database] : [];

  async function columnsFor(table: string): Promise<Set<string>> {
    const [rows] = await pool.execute<{ COLUMN_NAME: string }>(
      `SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = ${schemaExpr} AND table_name = ?`,
      [...schemaParams, table]
    );
    return new Set(rows.map((r) => r.COLUMN_NAME));
  }

  return {
    async tables() {
      const [rows] = await pool.execute<{ TABLE_NAME: string }>(
        `SELECT TABLE_NAME FROM information_schema.tables
         WHERE table_schema = ${schemaExpr} AND table_type = 'BASE TABLE'
         ORDER BY TABLE_NAME`,
        schemaParams
      );
      return rows.map((r) => r.TABLE_NAME);
    },

    async query(table, filter, limit) {
      assertValidIdentifier(table, "table");
      assertPositiveInteger(limit, "limit");

      const columns = await columnsFor(table);
      if (columns.size === 0) {
        throw new Error(
          `[guardbee-gateway] Table "${table}" not found in database "${options.database ?? "(current)"}".`
        );
      }

      const conditions: string[] = [];
      const values: unknown[] = [];
      for (const [key, value] of Object.entries(filter)) {
        assertValidIdentifier(key, "column");
        if (!columns.has(key)) {
          throw new Error(`[guardbee-gateway] Unknown column "${key}" on table "${table}".`);
        }
        values.push(value);
        conditions.push(`${quoteIdentifier(key, "`")} = ?`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const sql = `SELECT * FROM ${quoteIdentifier(table, "`")} ${whereClause} LIMIT ${limit}`;

      const [rows] = await pool.execute(sql, values);
      return rows;
    },
  };
}
