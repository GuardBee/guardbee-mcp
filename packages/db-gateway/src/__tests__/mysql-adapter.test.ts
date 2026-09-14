import { describe, it, expect } from "vitest";
import { createMysqlAdapter, type MysqlQueryable } from "../adapters/mysql";

function makeMockPool(): { pool: MysqlQueryable; calls: Array<{ sql: string; values: unknown[] }> } {
  const calls: Array<{ sql: string; values: unknown[] }> = [];

  const usersRows = [
    { id: 1, email: "a@b.com", status: "active" },
    { id: 2, email: "c@d.com", status: "inactive" },
  ];
  const usersColumns = ["id", "email", "status"].map((COLUMN_NAME) => ({ COLUMN_NAME }));

  const pool: MysqlQueryable = {
    async execute(sql, values = []) {
      calls.push({ sql, values });

      if (sql.startsWith("SELECT TABLE_NAME FROM information_schema.tables")) {
        return [[{ TABLE_NAME: "users" }, { TABLE_NAME: "orders" }], undefined];
      }
      if (sql.startsWith("SELECT COLUMN_NAME FROM information_schema.columns")) {
        const table = values.at(-1);
        return [table === "users" ? usersColumns : [], undefined];
      }
      if (sql.startsWith("INSERT INTO")) {
        return [{ affectedRows: 1, insertId: 7 }, undefined];
      }
      if (sql.startsWith("UPDATE")) {
        return [{ affectedRows: 2, insertId: 0 }, undefined];
      }
      if (sql.startsWith("DELETE FROM")) {
        return [{ affectedRows: 1, insertId: 0 }, undefined];
      }
      if (sql.includes("FROM") && sql.includes("users")) {
        const filtered = values.length > 0 ? usersRows.filter((r) => r.status === values[0]) : usersRows;
        return [filtered, undefined];
      }
      return [[], undefined];
    },
  };

  return { pool, calls };
}

describe("createMysqlAdapter — tables()", () => {
  it("information_schema.tables'tan tablo listesini döner", async () => {
    const { pool } = makeMockPool();
    const adapter = createMysqlAdapter(pool);
    expect(await adapter.tables()).toEqual(["users", "orders"]);
  });

  it("database opsiyonu verilince DATABASE() yerine parametre kullanır", async () => {
    const { pool, calls } = makeMockPool();
    const adapter = createMysqlAdapter(pool, { database: "shop" });
    await adapter.tables();
    expect(calls[0]?.sql).not.toContain("DATABASE()");
    expect(calls[0]?.values).toEqual(["shop"]);
  });
});

describe("createMysqlAdapter — query()", () => {
  it("filtresiz sorguda tüm satırları döner", async () => {
    const { pool } = makeMockPool();
    const adapter = createMysqlAdapter(pool);
    const rows = await adapter.query("users", {}, 50);
    expect(rows.length).toBe(2);
  });

  it("filtreyi parametrize edilmiş SQL'e çevirir (backtick + ?)", async () => {
    const { pool, calls } = makeMockPool();
    const adapter = createMysqlAdapter(pool);
    const rows = await adapter.query("users", { status: "active" }, 50);
    expect(rows).toEqual([{ id: 1, email: "a@b.com", status: "active" }]);

    const finalQuery = calls.at(-1);
    expect(finalQuery?.sql).toContain("`status` = ?");
    expect(finalQuery?.values).toEqual(["active"]);
  });

  it("limit'i doğrulanmış literal olarak SQL'e gömer", async () => {
    const { pool, calls } = makeMockPool();
    const adapter = createMysqlAdapter(pool);
    await adapter.query("users", {}, 5);
    expect(calls.at(-1)?.sql).toContain("LIMIT 5");
  });

  it("bilinmeyen tabloyu reddeder", async () => {
    const { pool } = makeMockPool();
    const adapter = createMysqlAdapter(pool);
    await expect(adapter.query("nonexistent", {}, 10)).rejects.toThrow('Table "nonexistent" not found');
  });

  it("bilinmeyen kolonu reddeder", async () => {
    const { pool } = makeMockPool();
    const adapter = createMysqlAdapter(pool);
    await expect(adapter.query("users", { evil: 1 }, 10)).rejects.toThrow('Unknown column "evil"');
  });

  it("SQL injection deneyen tablo adını schema sorgusuna gitmeden reddeder", async () => {
    const { pool, calls } = makeMockPool();
    const adapter = createMysqlAdapter(pool);
    await expect(adapter.query("users`; DROP TABLE users;--", {}, 10)).rejects.toThrow(
      "Invalid table name"
    );
    expect(calls.length).toBe(0);
  });

  it("geçersiz limit'i reddeder", async () => {
    const { pool } = makeMockPool();
    const adapter = createMysqlAdapter(pool);
    await expect(adapter.query("users", {}, 0)).rejects.toThrow("Invalid limit");
  });
});

describe("createMysqlAdapter — insert()", () => {
  it("INSERT SQL üretir, insertId'yi 'id' kolonuna ekler", async () => {
    const { pool, calls } = makeMockPool();
    const adapter = createMysqlAdapter(pool);
    const row = await adapter.insert!("users", { email: "new@x.com", status: "pending" });
    expect(row).toEqual({ email: "new@x.com", status: "pending", id: 7 });

    const insertCall = calls.at(-1);
    expect(insertCall?.sql).toContain("INSERT INTO");
    expect(insertCall?.sql).toContain("`email`, `status`");
    expect(insertCall?.values).toEqual(["new@x.com", "pending"]);
  });

  it("data zaten 'id' içeriyorsa insertId'yle üzerine yazmaz", async () => {
    const { pool } = makeMockPool();
    const adapter = createMysqlAdapter(pool);
    const row = await adapter.insert!("users", { id: 99, email: "x@y.com", status: "active" });
    expect(row["id"]).toBe(99);
  });

  it("bilinmeyen kolona insert'i reddeder", async () => {
    const { pool } = makeMockPool();
    const adapter = createMysqlAdapter(pool);
    await expect(adapter.insert!("users", { evil: 1 })).rejects.toThrow('Unknown column "evil"');
  });
});

describe("createMysqlAdapter — update()", () => {
  it("SET ve WHERE clause'larını parametrize eder, etkilenen satır sayısını döner", async () => {
    const { pool, calls } = makeMockPool();
    const adapter = createMysqlAdapter(pool);
    const count = await adapter.update!("users", { status: "active" }, { email: "changed@x.com" });
    expect(count).toBe(2);

    const updateCall = calls.at(-1);
    expect(updateCall?.sql).toContain("SET `email` = ?");
    expect(updateCall?.sql).toContain("WHERE `status` = ?");
    expect(updateCall?.values).toEqual(["changed@x.com", "active"]);
  });

  it("boş filtre ile reddeder", async () => {
    const { pool, calls } = makeMockPool();
    const adapter = createMysqlAdapter(pool);
    await expect(adapter.update!("users", {}, { email: "x" })).rejects.toThrow("non-empty filter");
    expect(calls.length).toBe(0);
  });

  it("boş data ile reddeder", async () => {
    const { pool } = makeMockPool();
    const adapter = createMysqlAdapter(pool);
    await expect(adapter.update!("users", { status: "active" }, {})).rejects.toThrow("at least one field");
  });
});

describe("createMysqlAdapter — delete()", () => {
  it("WHERE clause'unu parametrize eder, silinen satır sayısını döner", async () => {
    const { pool, calls } = makeMockPool();
    const adapter = createMysqlAdapter(pool);
    const count = await adapter.delete!("users", { status: "inactive" });
    expect(count).toBe(1);

    const deleteCall = calls.at(-1);
    expect(deleteCall?.sql).toContain("DELETE FROM");
    expect(deleteCall?.sql).toContain("WHERE `status` = ?");
    expect(deleteCall?.values).toEqual(["inactive"]);
  });

  it("boş filtre ile reddeder", async () => {
    const { pool, calls } = makeMockPool();
    const adapter = createMysqlAdapter(pool);
    await expect(adapter.delete!("users", {})).rejects.toThrow("non-empty filter");
    expect(calls.length).toBe(0);
  });

  it("SQL injection deneyen tablo adını reddeder", async () => {
    const { pool, calls } = makeMockPool();
    const adapter = createMysqlAdapter(pool);
    await expect(adapter.delete!("users`; DROP TABLE users;--", { status: "x" })).rejects.toThrow(
      "Invalid table name"
    );
    expect(calls.length).toBe(0);
  });
});
