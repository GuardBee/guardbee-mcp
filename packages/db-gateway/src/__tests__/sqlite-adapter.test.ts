import { describe, it, expect } from "vitest";
import { createSqliteAdapter, type SqliteQueryable } from "../adapters/sqlite";

function makeMockDb(): { db: SqliteQueryable; calls: Array<{ sql: string; params: unknown[] }> } {
  const calls: Array<{ sql: string; params: unknown[] }> = [];

  const usersRows = [
    { id: 1, email: "a@b.com", status: "active" },
    { id: 2, email: "c@d.com", status: "inactive" },
  ];
  const usersColumns = ["id", "email", "status"].map((name) => ({ name }));

  const db: SqliteQueryable = {
    prepare(sql: string) {
      return {
        all(...params: unknown[]) {
          calls.push({ sql, params });

          if (sql.startsWith("SELECT name FROM sqlite_master")) {
            return [{ name: "users" }, { name: "orders" }];
          }
          if (sql.startsWith("PRAGMA table_info")) {
            return sql.includes('"users"') ? usersColumns : [];
          }
          if (sql.startsWith("SELECT *")) {
            return params.length > 0 ? usersRows.filter((r) => r.status === params[0]) : usersRows;
          }
          return [];
        },
        run(...params: unknown[]) {
          calls.push({ sql, params });

          if (sql.startsWith("INSERT")) return { changes: 1, lastInsertRowid: 3 };
          if (sql.startsWith("UPDATE")) return { changes: 2, lastInsertRowid: 0 };
          if (sql.startsWith("DELETE")) return { changes: 1, lastInsertRowid: 0 };
          return { changes: 0, lastInsertRowid: 0 };
        },
      };
    },
  };

  return { db, calls };
}

describe("createSqliteAdapter — tables()", () => {
  it("sqlite_master'dan tablo listesini döner", async () => {
    const { db } = makeMockDb();
    const adapter = createSqliteAdapter(db);
    expect(await adapter.tables()).toEqual(["users", "orders"]);
  });
});

describe("createSqliteAdapter — query()", () => {
  it("filtresiz sorguda tüm satırları döner", async () => {
    const { db } = makeMockDb();
    const adapter = createSqliteAdapter(db);
    const rows = await adapter.query("users", {}, 50);
    expect(rows.length).toBe(2);
  });

  it("filtreyi parametrize edilmiş SQL'e çevirir", async () => {
    const { db, calls } = makeMockDb();
    const adapter = createSqliteAdapter(db);
    const rows = await adapter.query("users", { status: "active" }, 50);
    expect(rows).toEqual([{ id: 1, email: "a@b.com", status: "active" }]);

    const finalQuery = calls.at(-1);
    expect(finalQuery?.sql).toContain('"status" = ?');
    expect(finalQuery?.params).toEqual(["active"]);
  });

  it("limit'i doğrulanmış literal olarak SQL'e gömer", async () => {
    const { db, calls } = makeMockDb();
    const adapter = createSqliteAdapter(db);
    await adapter.query("users", {}, 5);
    expect(calls.at(-1)?.sql).toContain("LIMIT 5");
  });

  it("bilinmeyen tabloyu reddeder", async () => {
    const { db } = makeMockDb();
    const adapter = createSqliteAdapter(db);
    await expect(adapter.query("nonexistent", {}, 10)).rejects.toThrow('Table "nonexistent" not found');
  });

  it("bilinmeyen kolonu reddeder", async () => {
    const { db } = makeMockDb();
    const adapter = createSqliteAdapter(db);
    await expect(adapter.query("users", { evil: 1 }, 10)).rejects.toThrow('Unknown column "evil"');
  });

  it("SQL injection deneyen tablo adını şema sorgusuna gitmeden reddeder", async () => {
    const { db, calls } = makeMockDb();
    const adapter = createSqliteAdapter(db);
    await expect(adapter.query('users"; DROP TABLE users;--', {}, 10)).rejects.toThrow("Invalid table name");
    expect(calls.length).toBe(0);
  });

  it("SQL injection deneyen filter key'ini reddeder", async () => {
    const { db } = makeMockDb();
    const adapter = createSqliteAdapter(db);
    await expect(adapter.query("users", { '1"="1" OR "1': 1 }, 10)).rejects.toThrow("Invalid column name");
  });

  it("geçersiz limit'i reddeder", async () => {
    const { db } = makeMockDb();
    const adapter = createSqliteAdapter(db);
    await expect(adapter.query("users", {}, -1)).rejects.toThrow("Invalid limit");
  });
});

describe("createSqliteAdapter — insert()", () => {
  it("INSERT SQL üretir, id kolonu varsa lastInsertRowid'i satıra ekler", async () => {
    const { db, calls } = makeMockDb();
    const adapter = createSqliteAdapter(db);
    const row = await adapter.insert!("users", { email: "new@x.com", status: "pending" });
    expect(row).toEqual({ email: "new@x.com", status: "pending", id: 3 });

    const insertCall = calls.at(-1);
    expect(insertCall?.sql).toContain("INSERT INTO");
    expect(insertCall?.sql).toContain('"email", "status"');
    expect(insertCall?.params).toEqual(["new@x.com", "pending"]);
  });

  it("data'da id zaten varsa lastInsertRowid ile üzerine yazmaz", async () => {
    const { db } = makeMockDb();
    const adapter = createSqliteAdapter(db);
    const row = await adapter.insert!("users", { id: 99, email: "x@y.com", status: "active" });
    expect(row.id).toBe(99);
  });

  it("boş data için DEFAULT VALUES kullanır", async () => {
    const { db, calls } = makeMockDb();
    const adapter = createSqliteAdapter(db);
    await adapter.insert!("users", {});
    expect(calls.at(-1)?.sql).toContain("DEFAULT VALUES");
  });

  it("bilinmeyen kolona insert'i reddeder", async () => {
    const { db } = makeMockDb();
    const adapter = createSqliteAdapter(db);
    await expect(adapter.insert!("users", { evil: 1 })).rejects.toThrow('Unknown column "evil"');
  });

  it("SQL injection deneyen tablo adını reddeder", async () => {
    const { db, calls } = makeMockDb();
    const adapter = createSqliteAdapter(db);
    await expect(adapter.insert!('users"; DROP TABLE users;--', { email: "x" })).rejects.toThrow(
      "Invalid table name"
    );
    expect(calls.length).toBe(0);
  });
});

describe("createSqliteAdapter — update()", () => {
  it("SET ve WHERE clause'larını parametrize eder, etkilenen satır sayısını döner", async () => {
    const { db, calls } = makeMockDb();
    const adapter = createSqliteAdapter(db);
    const count = await adapter.update!("users", { status: "active" }, { email: "changed@x.com" });
    expect(count).toBe(2);

    const updateCall = calls.at(-1);
    expect(updateCall?.sql).toContain('SET "email" = ?');
    expect(updateCall?.sql).toContain('WHERE "status" = ?');
    expect(updateCall?.params).toEqual(["changed@x.com", "active"]);
  });

  it("boş filtre ile reddeder", async () => {
    const { db, calls } = makeMockDb();
    const adapter = createSqliteAdapter(db);
    await expect(adapter.update!("users", {}, { email: "x" })).rejects.toThrow("non-empty filter");
    expect(calls.length).toBe(0);
  });

  it("boş data ile reddeder", async () => {
    const { db } = makeMockDb();
    const adapter = createSqliteAdapter(db);
    await expect(adapter.update!("users", { status: "active" }, {})).rejects.toThrow("at least one field");
  });

  it("bilinmeyen kolona update'i reddeder", async () => {
    const { db } = makeMockDb();
    const adapter = createSqliteAdapter(db);
    await expect(adapter.update!("users", { status: "active" }, { evil: 1 })).rejects.toThrow(
      'Unknown column "evil"'
    );
  });
});

describe("createSqliteAdapter — delete()", () => {
  it("WHERE clause'unu parametrize eder, silinen satır sayısını döner", async () => {
    const { db, calls } = makeMockDb();
    const adapter = createSqliteAdapter(db);
    const count = await adapter.delete!("users", { status: "inactive" });
    expect(count).toBe(1);

    const deleteCall = calls.at(-1);
    expect(deleteCall?.sql).toContain("DELETE FROM");
    expect(deleteCall?.sql).toContain('WHERE "status" = ?');
    expect(deleteCall?.params).toEqual(["inactive"]);
  });

  it("boş filtre ile reddeder", async () => {
    const { db, calls } = makeMockDb();
    const adapter = createSqliteAdapter(db);
    await expect(adapter.delete!("users", {})).rejects.toThrow("non-empty filter");
    expect(calls.length).toBe(0);
  });

  it("SQL injection deneyen filter key'ini reddeder", async () => {
    const { db } = makeMockDb();
    const adapter = createSqliteAdapter(db);
    await expect(adapter.delete!("users", { '1"="1" OR "1': 1 })).rejects.toThrow("Invalid column name");
  });
});
