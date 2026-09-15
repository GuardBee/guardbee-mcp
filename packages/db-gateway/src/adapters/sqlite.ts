import type { DbAdapter } from "../types";
import { assertValidIdentifier, assertPositiveInteger, quoteIdentifier } from "./sql-utils";

/**
 * `better-sqlite3`'ün `Database`/`Statement` tiplerinin ortak kesişimi —
 * better-sqlite3 senkron çalışır, `DbAdapter` metotları async olduğu için
 * burada senkron sonuç bir Promise'e sarılır.
 */
export type SqliteStatement = {
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
};

export type SqliteQueryable = {
  prepare(sql: string): SqliteStatement;
};

/**
 * `better-sqlite3` Database örneğini kabul eder ve DbAdapter döner.
 *
 * Kullanım:
 * ```ts
 * import Database from "better-sqlite3";
 * import { createServer, createSqliteAdapter } from "@guardbee/mcp-db-gateway";
 *
 * const db = new Database("./app.db");
 * const server = createServer({}, createSqliteAdapter(db));
 * ```
 *
 * Güvenlik notu: tablo/kolon adları parametrize edilemediği için SQL'e
 * gömülmeden önce `PRAGMA table_info` üzerinden canlı şemayla doğrulanır —
 * whitelist'te olmayan bir tablo/kolon adı reddedilir (bkz. pg.ts/mysql.ts'teki
 * aynı desen). update/delete ayrıca boş filtreyi reddeder — asıl "tüm tabloyu
 * etkileme" koruması gateway pipeline'ındadır (maxAffectedRowsPerWrite), bu
 * sadece ek bir güvenlik ağı.
 *
 * SQLite dosya-bazlı olduğu için pg/mysql'deki gibi bir şema/veritabanı adı
 * seçeneği yoktur — bağlanılan dosyanın tamamı tek "şema"dır.
 */
export function createSqliteAdapter(db: SqliteQueryable): DbAdapter {
  function columnsFor(table: string): Set<string> {
    const rows = db.prepare(`PRAGMA table_info(${quoteIdentifier(table, '"')})`).all() as { name: string }[];
    return new Set(rows.map((r) => r.name));
  }

  /** Tabloyu ve verilen kolon adlarını doğrular, geçerli kolon whitelist'ini döner. */
  function requireValidatedColumns(table: string, keys: string[]): Set<string> {
    assertValidIdentifier(table, "table");
    const columns = columnsFor(table);
    if (columns.size === 0) {
      throw new Error(`[guardbee-gateway] Table "${table}" not found.`);
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
      const rows = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
        .all() as { name: string }[];
      return rows.map((r) => r.name);
    },

    async query(table, filter, limit) {
      assertPositiveInteger(limit, "limit");
      requireValidatedColumns(table, Object.keys(filter));

      const conditions: string[] = [];
      const values: unknown[] = [];
      for (const [key, value] of Object.entries(filter)) {
        values.push(value);
        conditions.push(`${quoteIdentifier(key, '"')} = ?`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const sql = `SELECT * FROM ${quoteIdentifier(table, '"')} ${whereClause} LIMIT ${limit}`;

      return db.prepare(sql).all(...values) as Record<string, unknown>[];
    },

    async insert(table, data) {
      const keys = Object.keys(data);
      const columns = requireValidatedColumns(table, keys);

      const values = keys.map((k) => data[k]);
      const sql =
        keys.length > 0
          ? `INSERT INTO ${quoteIdentifier(table, '"')} (${keys.map((k) => quoteIdentifier(k, '"')).join(", ")}) ` +
            `VALUES (${keys.map(() => "?").join(", ")})`
          : `INSERT INTO ${quoteIdentifier(table, '"')} DEFAULT VALUES`;

      const result = db.prepare(sql).run(...values);
      const insertedRow: Record<string, unknown> = { ...data };
      if (columns.has("id") && !("id" in data)) {
        insertedRow.id = result.lastInsertRowid;
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
      requireValidatedColumns(table, [...dataKeys, ...filterKeys]);

      const values: unknown[] = [...dataKeys.map((k) => data[k]), ...filterKeys.map((k) => filter[k])];
      const setClauses = dataKeys.map((k) => `${quoteIdentifier(k, '"')} = ?`);
      const conditions = filterKeys.map((k) => `${quoteIdentifier(k, '"')} = ?`);

      const sql = `UPDATE ${quoteIdentifier(table, '"')} SET ${setClauses.join(", ")} WHERE ${conditions.join(" AND ")}`;
      const result = db.prepare(sql).run(...values);
      return result.changes;
    },

    async delete(table, filter) {
      const filterKeys = Object.keys(filter);
      if (filterKeys.length === 0) {
        throw new Error("[guardbee-gateway] delete requires a non-empty filter.");
      }
      requireValidatedColumns(table, filterKeys);

      const values = filterKeys.map((k) => filter[k]);
      const conditions = filterKeys.map((k) => `${quoteIdentifier(k, '"')} = ?`);

      const sql = `DELETE FROM ${quoteIdentifier(table, '"')} WHERE ${conditions.join(" AND ")}`;
      const result = db.prepare(sql).run(...values);
      return result.changes;
    },
  };
}
