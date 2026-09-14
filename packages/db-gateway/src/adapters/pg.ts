import type { DbAdapter } from "../types";
import { assertValidIdentifier, assertPositiveInteger, quoteIdentifier } from "./sql-utils";

/** `pg`'nin Pool/Client/PoolClient tiplerinin ortak kesişimi — hepsi bu şekli sağlar. */
export type PgQueryable = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
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
 * whitelist'te olmayan bir tablo/kolon adı reddedilir. update/delete ayrıca
 * boş filtreyi reddeder — asıl "tüm tabloyu etkileme" koruması gateway
 * pipeline'ındadır (maxAffectedRowsPerWrite), bu sadece ek bir güvenlik ağı.
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

  /** Tabloyu ve verilen kolon adlarını doğrular, geçerli kolon whitelist'ini döner. */
  async function requireValidatedColumns(table: string, keys: string[]): Promise<Set<string>> {
    assertValidIdentifier(table, "table");
    const columns = await columnsFor(table);
    if (columns.size === 0) {
      throw new Error(`[guardbee-gateway] Table "${table}" not found in schema "${schema}".`);
    }
    for (const key of keys) {
      assertValidIdentifier(key, "column");
      if (!columns.has(key)) {
        throw new Error(`[guardbee-gateway] Unknown column "${key}" on table "${table}".`);
      }
    }
    return columns;
  }

  const qualifiedTable = (table: string) => `${quoteIdentifier(schema, '"')}.${quoteIdentifier(table, '"')}`;

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
      assertPositiveInteger(limit, "limit");
      await requireValidatedColumns(table, Object.keys(filter));

      const conditions: string[] = [];
      const values: unknown[] = [];
      for (const [key, value] of Object.entries(filter)) {
        values.push(value);
        conditions.push(`${quoteIdentifier(key, '"')} = $${values.length}`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const sql = `SELECT * FROM ${qualifiedTable(table)} ${whereClause} LIMIT ${limit}`;

      const result = await pool.query(sql, values);
      return result.rows;
    },

    async insert(table, data) {
      const keys = Object.keys(data);
      await requireValidatedColumns(table, keys);

      const values = keys.map((k) => data[k]);
      const sql =
        keys.length > 0
          ? `INSERT INTO ${qualifiedTable(table)} (${keys.map((k) => quoteIdentifier(k, '"')).join(", ")}) ` +
            `VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`
          : `INSERT INTO ${qualifiedTable(table)} DEFAULT VALUES RETURNING *`;

      const result = await pool.query(sql, values);
      return result.rows[0] ?? {};
    },

    async update(table, filter, data) {
      const dataKeys = Object.keys(data);
      if (dataKeys.length === 0) {
        throw new Error("[guardbee-gateway] update requires at least one field to set.");
      }
      const filterKeys = Object.keys(filter);
      if (filterKeys.length === 0) {
        throw new Error("[guardbee-gateway] update requires a non-empty filter.");
      }
      await requireValidatedColumns(table, [...dataKeys, ...filterKeys]);

      const values: unknown[] = [];
      const setClauses = dataKeys.map((k) => {
        values.push(data[k]);
        return `${quoteIdentifier(k, '"')} = $${values.length}`;
      });
      const conditions = filterKeys.map((k) => {
        values.push(filter[k]);
        return `${quoteIdentifier(k, '"')} = $${values.length}`;
      });

      const sql = `UPDATE ${qualifiedTable(table)} SET ${setClauses.join(", ")} WHERE ${conditions.join(" AND ")}`;
      const result = await pool.query(sql, values);
      return result.rowCount ?? 0;
    },

    async delete(table, filter) {
      const filterKeys = Object.keys(filter);
      if (filterKeys.length === 0) {
        throw new Error("[guardbee-gateway] delete requires a non-empty filter.");
      }
      await requireValidatedColumns(table, filterKeys);

      const values: unknown[] = [];
      const conditions = filterKeys.map((k) => {
        values.push(filter[k]);
        return `${quoteIdentifier(k, '"')} = $${values.length}`;
      });

      const sql = `DELETE FROM ${qualifiedTable(table)} WHERE ${conditions.join(" AND ")}`;
      const result = await pool.query(sql, values);
      return result.rowCount ?? 0;
    },
  };
}
