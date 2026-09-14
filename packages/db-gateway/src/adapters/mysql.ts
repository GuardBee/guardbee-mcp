import type { DbAdapter } from "../types";
import { assertValidIdentifier, assertPositiveInteger, quoteIdentifier } from "./sql-utils";

/**
 * `mysql2/promise`'in Pool/PoolConnection tiplerinin ortak kesişimi.
 * Dönüş şekli sorguya göre değişir (mysql2'nin kendisi de böyle): SELECT için
 * satır dizisi, INSERT/UPDATE/DELETE için `{ affectedRows, insertId }` içeren
 * bir ResultSetHeader — bu yüzden burada geniş `unknown` tutulup her metotta
 * beklenen şekle cast ediliyor.
 */
export type MysqlQueryable = {
  execute(sql: string, values?: unknown[]): Promise<[unknown, unknown]>;
};

type ResultSetHeader = { affectedRows?: number; insertId?: number };

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
 * whitelist'te olmayan bir tablo/kolon adı reddedilir. update/delete ayrıca
 * boş filtreyi reddeder — asıl "tüm tabloyu etkileme" koruması gateway
 * pipeline'ındadır (maxAffectedRowsPerWrite), bu sadece ek bir güvenlik ağı.
 *
 * MySQL'de `RETURNING` desteklenmediği için insert, eklenen veriyi
 * `insertId`'yle (tabloda "id" kolonu varsa ve data'da zaten yoksa) birleştirip
 * döner — Postgres adaptöründeki gibi satırı DB'den tekrar okumaz.
 */
export function createMysqlAdapter(pool: MysqlQueryable, options: MysqlAdapterOptions = {}): DbAdapter {
  const schemaExpr = options.database ? "?" : "DATABASE()";
  const schemaParams = options.database ? [options.database] : [];

  async function columnsFor(table: string): Promise<Set<string>> {
    const [rows] = await pool.execute(
      `SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = ${schemaExpr} AND table_name = ?`,
      [...schemaParams, table]
    );
    return new Set((rows as { COLUMN_NAME: string }[]).map((r) => r.COLUMN_NAME));
  }

  /** Tabloyu ve verilen kolon adlarını doğrular, geçerli kolon whitelist'ini döner. */
  async function requireValidatedColumns(table: string, keys: string[]): Promise<Set<string>> {
    assertValidIdentifier(table, "table");
    const columns = await columnsFor(table);
    if (columns.size === 0) {
      throw new Error(
        `[guardbee-gateway] Table "${table}" not found in database "${options.database ?? "(current)"}".`
      );
    }
    for (const key of keys) {
      assertValidIdentifier(key, "column");
      if (!columns.has(key)) {
        throw new Error(`[guardbee-gateway] Unknown column "${key}" on table "${table}".`);
      }
    }
    return columns;
  }

  return {
    async tables() {
      const [rows] = await pool.execute(
        `SELECT TABLE_NAME FROM information_schema.tables
         WHERE table_schema = ${schemaExpr} AND table_type = 'BASE TABLE'
         ORDER BY TABLE_NAME`,
        schemaParams
      );
      return (rows as { TABLE_NAME: string }[]).map((r) => r.TABLE_NAME);
    },

    async query(table, filter, limit) {
      assertPositiveInteger(limit, "limit");
      await requireValidatedColumns(table, Object.keys(filter));

      const conditions: string[] = [];
      const values: unknown[] = [];
      for (const [key, value] of Object.entries(filter)) {
        values.push(value);
        conditions.push(`${quoteIdentifier(key, "`")} = ?`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const sql = `SELECT * FROM ${quoteIdentifier(table, "`")} ${whereClause} LIMIT ${limit}`;

      const [rows] = await pool.execute(sql, values);
      return rows as Record<string, unknown>[];
    },

    async insert(table, data) {
      const keys = Object.keys(data);
      const columns = await requireValidatedColumns(table, keys);

      const values = keys.map((k) => data[k]);
      const sql =
        keys.length > 0
          ? `INSERT INTO ${quoteIdentifier(table, "`")} (${keys.map((k) => quoteIdentifier(k, "`")).join(", ")}) ` +
            `VALUES (${keys.map(() => "?").join(", ")})`
          : `INSERT INTO ${quoteIdentifier(table, "`")} () VALUES ()`;

      const [result] = await pool.execute(sql, values);
      const header = result as ResultSetHeader;

      const insertedRow: Record<string, unknown> = { ...data };
      if (header.insertId && columns.has("id") && !("id" in data)) {
        insertedRow.id = header.insertId;
      }
      return insertedRow;
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

      const values: unknown[] = [...dataKeys.map((k) => data[k]), ...filterKeys.map((k) => filter[k])];
      const setClauses = dataKeys.map((k) => `${quoteIdentifier(k, "`")} = ?`);
      const conditions = filterKeys.map((k) => `${quoteIdentifier(k, "`")} = ?`);

      const sql = `UPDATE ${quoteIdentifier(table, "`")} SET ${setClauses.join(", ")} WHERE ${conditions.join(" AND ")}`;
      const [result] = await pool.execute(sql, values);
      return (result as ResultSetHeader).affectedRows ?? 0;
    },

    async delete(table, filter) {
      const filterKeys = Object.keys(filter);
      if (filterKeys.length === 0) {
        throw new Error("[guardbee-gateway] delete requires a non-empty filter.");
      }
      await requireValidatedColumns(table, filterKeys);

      const values = filterKeys.map((k) => filter[k]);
      const conditions = filterKeys.map((k) => `${quoteIdentifier(k, "`")} = ?`);

      const sql = `DELETE FROM ${quoteIdentifier(table, "`")} WHERE ${conditions.join(" AND ")}`;
      const [result] = await pool.execute(sql, values);
      return (result as ResultSetHeader).affectedRows ?? 0;
    },
  };
}
