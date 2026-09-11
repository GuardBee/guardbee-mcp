import type { DbAdapter } from "../types";
import { assertValidIdentifier, assertPositiveInteger, quoteIdentifier } from "./sql-utils";

/** `pg`'nin Pool/Client/PoolClient tiplerinin ortak kesişimi — hepsi bu şekli sağlar. */
export type PgQueryable = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: T[] }>;
};

export type PgAdapterOptions = {
  /** Sorgulanacak Postgres şeması. Default: "public". */
  schema?: string;
};

/**
 * `pg` (node-postgres) Pool/Client'ı kabul eder ve DbAdapter döner.
 * Prisma kullanmayan, ham Postgres bağlantısı olan müşteriler için.
 *
 * Kullanım:
 * ```ts
 * import { Pool } from "pg";
 * import { createServer, createPgAdapter } from "@guardbee/mcp-db-gateway";
 *
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 * const server = createServer({}, createPgAdapter(pool));
 * ```
 *
 * Güvenlik notu: tablo/kolon adları parametrize edilemediği için SQL'e
 * gömülmeden önce `information_schema` üzerinden canlı şemayla doğrulanır —
 * whitelist'te olmayan bir tablo/kolon adı reddedilir.
 */
export function createPgAdapter(pool: PgQueryable, options: PgAdapterOptions = {}): DbAdapter {
  const schema = options.schema ?? "public";

  async function columnsFor(table: string): Promise<Set<string>> {
    const result = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
      [schema, table]
    );
    return new Set(result.rows.map((r) => r.column_name));
  }

  return {
    async tables() {
      const result = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = $1 AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
        [schema]
      );
      return result.rows.map((r) => r.table_name);
    },

    async query(table, filter, limit) {
      assertValidIdentifier(table, "table");
      assertPositiveInteger(limit, "limit");

      const columns = await columnsFor(table);
      if (columns.size === 0) {
        throw new Error(`[guardbee-gateway] Table "${table}" not found in schema "${schema}".`);
      }

      const conditions: string[] = [];
      const values: unknown[] = [];
      for (const [key, value] of Object.entries(filter)) {
        assertValidIdentifier(key, "column");
        if (!columns.has(key)) {
          throw new Error(`[guardbee-gateway] Unknown column "${key}" on table "${table}".`);
        }
        values.push(value);
        conditions.push(`${quoteIdentifier(key, '"')} = $${values.length}`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const sql = `SELECT * FROM ${quoteIdentifier(schema, '"')}.${quoteIdentifier(table, '"')} ${whereClause} LIMIT ${limit}`;

      const result = await pool.query(sql, values);
      return result.rows;
    },
  };
}
