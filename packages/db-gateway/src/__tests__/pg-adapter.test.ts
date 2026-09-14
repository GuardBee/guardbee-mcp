import { describe, it, expect } from "vitest";
import { createPgAdapter, type PgQueryable } from "../adapters/pg";

function makeMockPool(): { pool: PgQueryable; calls: Array<{ text: string; values: unknown[] }> } {
  const calls: Array<{ text: string; values: unknown[] }> = [];

  const usersRows = [
    { id: 1, email: "a@b.com", status: "active" },
    { id: 2, email: "c@d.com", status: "inactive" },
  ];
  const usersColumns = ["id", "email", "status"].map((column_name) => ({ column_name }));

  const pool: PgQueryable = {
    async query(text, values = []) {
      calls.push({ text, values });

      if (text.startsWith("SELECT table_name FROM information_schema.tables")) {
        return { rows: [{ table_name: "users" }, { table_name: "orders" }] };
      }
      if (text.startsWith("SELECT column_name FROM information_schema.columns")) {
        const table = values[1];
        return { rows: table === "users" ? usersColumns : [] };
      }
      if (text.startsWith("INSERT INTO")) {
        return { rows: [{ id: 3, email: "new@x.com", status: "pending" }] };
      }
      if (text.startsWith("UPDATE")) {
        return { rows: [], rowCount: 2 };
      }
      if (text.startsWith("DELETE FROM")) {
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("FROM") && text.includes("users")) {
        const filtered =
          values.length > 0
            ? usersRows.filter((r) => r.status === values[0])
            : usersRows;
        return { rows: filtered };
      }
      return { rows: [] };
    },
  };

  return { pool, calls };
}

describe("createPgAdapter — tables()", () => {
  it("information_schema.tables'tan tablo listesini döner", async () => {
    const { pool } = makeMockPool();
    const adapter = createPgAdapter(pool);
    expect(await adapter.tables()).toEqual(["users", "orders"]);
  });
});

describe("createPgAdapter — query()", () => {
  it("filtresiz sorguda tüm satırları döner", async () => {
    const { pool } = makeMockPool();
    const adapter = createPgAdapter(pool);
    const rows = await adapter.query("users", {}, 50);
    expect(rows.length).toBe(2);
  });

  it("filtreyi parametrize edilmiş SQL'e çevirir", async () => {
    const { pool, calls } = makeMockPool();
    const adapter = createPgAdapter(pool);
    const rows = await adapter.query("users", { status: "active" }, 50);
    expect(rows).toEqual([{ id: 1, email: "a@b.com", status: "active" }]);

    const finalQuery = calls.at(-1);
    expect(finalQuery?.text).toContain('"status" = $1');
    expect(finalQuery?.values).toEqual(["active"]);
  });

  it("limit'i doğrulanmış literal olarak SQL'e gömer", async () => {
    const { pool, calls } = makeMockPool();
    const adapter = createPgAdapter(pool);
    await adapter.query("users", {}, 5);
    expect(calls.at(-1)?.text).toContain("LIMIT 5");
  });

  it("bilinmeyen tabloyu reddeder", async () => {
    const { pool } = makeMockPool();
    const adapter = createPgAdapter(pool);
    await expect(adapter.query("nonexistent", {}, 10)).rejects.toThrow('Table "nonexistent" not found');
  });

  it("bilinmeyen kolonu reddeder", async () => {
    const { pool } = makeMockPool();
    const adapter = createPgAdapter(pool);
    await expect(adapter.query("users", { evil: 1 }, 10)).rejects.toThrow('Unknown column "evil"');
  });

  it("SQL injection deneyen tablo adını schema sorgusuna gitmeden reddeder", async () => {
    const { pool, calls } = makeMockPool();
    const adapter = createPgAdapter(pool);
    await expect(adapter.query('users"; DROP TABLE users;--', {}, 10)).rejects.toThrow(
      "Invalid table name"
    );
    expect(calls.length).toBe(0);
  });

  it("SQL injection deneyen filter key'ini reddeder", async () => {
    const { pool } = makeMockPool();
    const adapter = createPgAdapter(pool);
    await expect(
      adapter.query("users", { '1"="1" OR "1': 1 }, 10)
    ).rejects.toThrow("Invalid column name");
  });

  it("geçersiz limit'i reddeder", async () => {
    const { pool } = makeMockPool();
    const adapter = createPgAdapter(pool);
    await expect(adapter.query("users", {}, -1)).rejects.toThrow("Invalid limit");
  });

  it("özel schema kullanır", async () => {
    const { pool, calls } = makeMockPool();
    const adapter = createPgAdapter(pool, { schema: "tenant_a" });
    await adapter.tables();
    expect(calls[0]?.values).toEqual(["tenant_a"]);
  });
});

describe("createPgAdapter — insert()", () => {
  it("INSERT SQL üretir ve RETURNING * ile eklenen satırı döner", async () => {
    const { pool, calls } = makeMockPool();
    const adapter = createPgAdapter(pool);
    const row = await adapter.insert!("users", { email: "new@x.com", status: "pending" });
    expect(row).toEqual({ id: 3, email: "new@x.com", status: "pending" });

    const insertCall = calls.at(-1);
    expect(insertCall?.text).toContain("INSERT INTO");
    expect(insertCall?.text).toContain('"email", "status"');
    expect(insertCall?.text).toContain("RETURNING *");
    expect(insertCall?.values).toEqual(["new@x.com", "pending"]);
  });

  it("boş data için DEFAULT VALUES kullanır", async () => {
    const { pool, calls } = makeMockPool();
    const adapter = createPgAdapter(pool);
    await adapter.insert!("users", {});
    expect(calls.at(-1)?.text).toContain("DEFAULT VALUES");
  });

  it("bilinmeyen kolona insert'i reddeder", async () => {
    const { pool } = makeMockPool();
    const adapter = createPgAdapter(pool);
    await expect(adapter.insert!("users", { evil: 1 })).rejects.toThrow('Unknown column "evil"');
  });

  it("SQL injection deneyen tablo adını reddeder", async () => {
    const { pool, calls } = makeMockPool();
    const adapter = createPgAdapter(pool);
    await expect(adapter.insert!('users"; DROP TABLE users;--', { email: "x" })).rejects.toThrow(
      "Invalid table name"
    );
    expect(calls.length).toBe(0);
  });
});

describe("createPgAdapter — update()", () => {
  it("SET ve WHERE clause'larını parametrize eder, etkilenen satır sayısını döner", async () => {
    const { pool, calls } = makeMockPool();
    const adapter = createPgAdapter(pool);
    const count = await adapter.update!("users", { status: "active" }, { email: "changed@x.com" });
    expect(count).toBe(2);

    const updateCall = calls.at(-1);
    expect(updateCall?.text).toContain('SET "email" = $1');
    expect(updateCall?.text).toContain('WHERE "status" = $2');
    expect(updateCall?.values).toEqual(["changed@x.com", "active"]);
  });

  it("boş filtre ile reddeder", async () => {
    const { pool, calls } = makeMockPool();
    const adapter = createPgAdapter(pool);
    await expect(adapter.update!("users", {}, { email: "x" })).rejects.toThrow("non-empty filter");
    expect(calls.length).toBe(0);
  });

  it("boş data ile reddeder", async () => {
    const { pool } = makeMockPool();
    const adapter = createPgAdapter(pool);
    await expect(adapter.update!("users", { status: "active" }, {})).rejects.toThrow(
      "at least one field"
    );
  });

  it("bilinmeyen kolona update'i reddeder", async () => {
    const { pool } = makeMockPool();
    const adapter = createPgAdapter(pool);
    await expect(adapter.update!("users", { status: "active" }, { evil: 1 })).rejects.toThrow(
      'Unknown column "evil"'
    );
  });
});

describe("createPgAdapter — delete()", () => {
  it("WHERE clause'unu parametrize eder, silinen satır sayısını döner", async () => {
    const { pool, calls } = makeMockPool();
    const adapter = createPgAdapter(pool);
    const count = await adapter.delete!("users", { status: "inactive" });
    expect(count).toBe(1);

    const deleteCall = calls.at(-1);
    expect(deleteCall?.text).toContain('DELETE FROM');
    expect(deleteCall?.text).toContain('WHERE "status" = $1');
    expect(deleteCall?.values).toEqual(["inactive"]);
  });

  it("boş filtre ile reddeder", async () => {
    const { pool, calls } = makeMockPool();
    const adapter = createPgAdapter(pool);
    await expect(adapter.delete!("users", {})).rejects.toThrow("non-empty filter");
    expect(calls.length).toBe(0);
  });

  it("SQL injection deneyen filter key'ini reddeder", async () => {
    const { pool } = makeMockPool();
    const adapter = createPgAdapter(pool);
    await expect(adapter.delete!("users", { '1"="1" OR "1': 1 })).rejects.toThrow("Invalid column name");
  });
});
