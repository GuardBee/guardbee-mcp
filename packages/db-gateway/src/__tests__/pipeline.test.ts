import { describe, it, expect, vi, beforeEach } from "vitest";
import { GatewayPipeline } from "../gateway/pipeline";
import { loadConfig } from "../config";

const baseRows = [
  {
    id: "u1",
    email: "ahmet@example.com",
    tcKimlik: "12345678901",
    passwordHash: "$2b$10$abc",
    firstName: "Ahmet",
  },
];

function makePipeline(overrides = {}) {
  const config = loadConfig({
    audit: { enabled: false, sink: "console" as const },
    ...overrides,
  });
  return new GatewayPipeline(config);
}

describe("GatewayPipeline — tablo erişim kontrolü", () => {
  it("deny tableRule → DeniedResult döner", async () => {
    const pipeline = makePipeline({
      tableRules: [{ table: "users", access: "deny" }],
    });
    const result = await pipeline.process("query_table", "users", {}, baseRows);
    expect("denied" in result).toBe(true);
    if ("denied" in result) {
      expect(result.reason).toContain("denied by gateway policy");
    }
  });

  it("allow tableRule → QueryResult döner", async () => {
    const pipeline = makePipeline({
      tableRules: [{ table: "users", access: "allow" }],
    });
    const result = await pipeline.process("query_table", "users", {}, baseRows);
    expect("rows" in result).toBe(true);
  });
});

describe("GatewayPipeline — PII maskeleme", () => {
  it("tcKimlik redact, email mask, passwordHash redact uygulanır", async () => {
    const pipeline = makePipeline();
    const result = await pipeline.process("query_table", "users", {}, baseRows);
    expect("rows" in result).toBe(true);
    if ("rows" in result) {
      const row = result.rows[0] as Record<string, unknown>;
      expect(row["tcKimlik"]).toBe("[REDACTED]");
      expect(row["passwordHash"]).toBe("[REDACTED]");
      expect(row["email"]).toMatch(/\*\*\*/);
      expect(row["firstName"]).toBe("Ahmet"); // maskelenmez
    }
  });

  it("auditId döndürülür", async () => {
    const pipeline = makePipeline();
    const result = await pipeline.process("query_table", "users", {}, baseRows);
    expect("auditId" in result).toBe(true);
  });
});

describe("GatewayPipeline — row limit", () => {
  const manyRows = Array.from({ length: 10 }, (_, i) => ({ id: i, email: `u${i}@x.com` }));

  it("defaultMaxRows aşılınca truncated=true", async () => {
    const pipeline = makePipeline({ defaultMaxRows: 5 });
    const result = await pipeline.process("query_table", "users", {}, manyRows);
    if ("rows" in result) {
      expect(result.truncated).toBe(true);
      expect(result.rows.length).toBe(5);
      expect(result.totalBeforeTruncation).toBe(10);
    }
  });

  it("tablo kuralındaki maxRows önceliklidir", async () => {
    const pipeline = makePipeline({
      defaultMaxRows: 50,
      tableRules: [{ table: "users", access: "allow", maxRows: 3 }],
    });
    const result = await pipeline.process("query_table", "users", {}, manyRows);
    if ("rows" in result) {
      expect(result.rows.length).toBe(3);
    }
  });
});

describe("GatewayPipeline — RBAC", () => {
  it("rol allowTables dışı tablo → DeniedResult", async () => {
    const pipeline = makePipeline({
      roles: [{ name: "bot", allowTables: ["products"] }],
      activeRole: "bot",
    });
    const result = await pipeline.process("query_table", "users", {}, baseRows);
    expect("denied" in result).toBe(true);
    if ("denied" in result) {
      expect(result.reason).toContain("not in the allowed table list");
    }
  });

  it("rol fieldRules global kuralların önünde uygulanır", async () => {
    const pipeline = makePipeline({
      roles: [
        {
          name: "analyst",
          fieldRules: [{ field: "email", strategy: "allow" as const }],
        },
      ],
      activeRole: "analyst",
    });
    const result = await pipeline.process("query_table", "users", {}, baseRows);
    if ("rows" in result) {
      const row = result.rows[0] as Record<string, unknown>;
      // Analyst için email maskesiz gelir
      expect(row["email"]).toBe("ahmet@example.com");
    }
  });
});

describe("GatewayPipeline — rate limiting", () => {
  it("global limit aşılınca DeniedResult + retryAfterMs", async () => {
    const pipeline = makePipeline({
      rateLimit: { enabled: true, windowMs: 60_000, maxRequests: 2, maxRequestsPerTable: 10 },
    });
    await pipeline.process("query_table", "users", {}, baseRows);
    await pipeline.process("query_table", "orders", {}, baseRows);
    const result = await pipeline.process("query_table", "users", {}, baseRows);
    expect("denied" in result).toBe(true);
    if ("denied" in result) {
      expect(result.reason).toContain("Rate limit exceeded");
      expect(result.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it("per-table limit aşılınca o tabloya özel hata", async () => {
    const pipeline = makePipeline({
      rateLimit: { enabled: true, windowMs: 60_000, maxRequests: 100, maxRequestsPerTable: 1 },
    });
    await pipeline.process("query_table", "users", {}, baseRows);
    const result = await pipeline.process("query_table", "users", {}, baseRows);
    expect("denied" in result).toBe(true);
    if ("denied" in result) {
      expect(result.reason).toContain("users");
    }
  });
});

describe("GatewayPipeline — filterTables", () => {
  it("rol olmadan tüm tablolar görünür", () => {
    const pipeline = makePipeline();
    expect(pipeline.filterTables(["users", "orders"])).toEqual(["users", "orders"]);
  });

  it("ai-agent rolü allowTables dışını filtreler", () => {
    const pipeline = makePipeline({
      roles: [{ name: "ai-agent", allowTables: ["products"] }],
      activeRole: "ai-agent",
    });
    expect(pipeline.filterTables(["users", "products", "orders"])).toEqual(["products"]);
  });
});

describe("GatewayPipeline — authorizeWrite", () => {
  it("writesEnabled false iken (default) her write reddedilir", () => {
    return makePipeline({
      tableRules: [{ table: "orders", access: "allow", write: { insert: true, update: true, delete: true } }],
    })
      .authorizeWrite("insert_row", "orders", "insert", undefined, { amount: 10 })
      .then((result) => {
        expect("denied" in result).toBe(true);
        if ("denied" in result) expect(result.reason).toContain("Writes are disabled");
      });
  });

  it("writesEnabled true ama tablo write izni yoksa reddedilir", async () => {
    const pipeline = makePipeline({
      writesEnabled: true,
      tableRules: [{ table: "orders", access: "allow" }],
    });
    const result = await pipeline.authorizeWrite("insert_row", "orders", "insert", undefined, { amount: 10 });
    expect("denied" in result).toBe(true);
  });

  it("writesEnabled true ve tablo izni varsa kabul edilir", async () => {
    const pipeline = makePipeline({
      writesEnabled: true,
      tableRules: [{ table: "orders", access: "allow", write: { insert: true, update: false, delete: false } }],
    });
    const result = await pipeline.authorizeWrite("insert_row", "orders", "insert", undefined, { amount: 10 });
    expect(result).toEqual({ allowed: true, tableRule: expect.objectContaining({ table: "orders" }) });
  });

  it("korumalı (redact/mask) alana yazma reddedilir", async () => {
    const pipeline = makePipeline({
      writesEnabled: true,
      tableRules: [{ table: "users", access: "allow", write: { insert: true, update: false, delete: false } }],
    });
    const result = await pipeline.authorizeWrite("insert_row", "users", "insert", undefined, { tcKimlik: "1", firstName: "Ali" });
    expect("denied" in result).toBe(true);
    if ("denied" in result) expect(result.reason).toContain("tcKimlik");
  });

  it("update/delete boş filtre ile reddedilir", async () => {
    const pipeline = makePipeline({
      writesEnabled: true,
      tableRules: [{ table: "orders", access: "allow", write: { insert: true, update: true, delete: true } }],
    });
    const updateResult = await pipeline.authorizeWrite("update_row", "orders", "update", {}, { status: "shipped" });
    expect("denied" in updateResult).toBe(true);
    if ("denied" in updateResult) expect(updateResult.reason).toContain("non-empty filter");

    const deleteResult = await pipeline.authorizeWrite("delete_row", "orders", "delete", undefined, undefined);
    expect("denied" in deleteResult).toBe(true);
  });

  it("insert için filtre gerekmez", async () => {
    const pipeline = makePipeline({
      writesEnabled: true,
      tableRules: [{ table: "orders", access: "allow", write: { insert: true, update: false, delete: false } }],
    });
    const result = await pipeline.authorizeWrite("insert_row", "orders", "insert", undefined, { amount: 10 });
    expect("denied" in result).toBe(false);
  });

  it("global tableRules deny write'ı da engeller", async () => {
    const pipeline = makePipeline({
      writesEnabled: true,
      tableRules: [{ table: "orders", access: "deny", write: { insert: true, update: true, delete: true } }],
    });
    const result = await pipeline.authorizeWrite("insert_row", "orders", "insert", undefined, { amount: 10 });
    expect("denied" in result).toBe(true);
    if ("denied" in result) expect(result.reason).toContain("denied by gateway policy");
  });

  it("write rate limiti read'den ayrıdır", async () => {
    const pipeline = makePipeline({
      writesEnabled: true,
      tableRules: [{ table: "orders", access: "allow", write: { insert: true, update: false, delete: false } }],
      rateLimit: { enabled: true, windowMs: 60_000, maxRequests: 100, maxRequestsPerTable: 100, maxWrites: 1, maxWritesPerTable: 100 },
    });
    await pipeline.authorizeWrite("insert_row", "orders", "insert", undefined, { amount: 1 });
    const result = await pipeline.authorizeWrite("insert_row", "orders", "insert", undefined, { amount: 2 });
    expect("denied" in result).toBe(true);
    if ("denied" in result) expect(result.reason).toContain("write rate limit");
  });
});

describe("GatewayPipeline — checkAffectedRows", () => {
  it("limit aşılmazsa izin verir", async () => {
    const pipeline = makePipeline({ maxAffectedRowsPerWrite: 10 });
    const result = await pipeline.checkAffectedRows("update_row", "orders", "update", { status: "x" }, { a: 1 }, 5);
    expect(result).toEqual({ allowed: true });
  });

  it("limit aşılırsa reddeder ve audit'e yazar", async () => {
    const pipeline = makePipeline({ maxAffectedRowsPerWrite: 3 });
    const result = await pipeline.checkAffectedRows("delete_row", "orders", "delete", { status: "x" }, undefined, 4);
    expect("denied" in result).toBe(true);
    if ("denied" in result) {
      expect(result.reason).toContain("exceeds maxAffectedRowsPerWrite");
      expect(result.auditId).toBeTruthy();
    }
  });
});

describe("GatewayPipeline — recordWrite", () => {
  it("insert edilen satırı maskeleyerek döner", async () => {
    const pipeline = makePipeline();
    const result = await pipeline.recordWrite(
      "insert_row",
      "users",
      "insert",
      undefined,
      { tcKimlik: "12345678901", firstName: "Ali" },
      1,
      { id: "u9", tcKimlik: "12345678901", firstName: "Ali" },
      Date.now()
    );
    expect(result.row?.["tcKimlik"]).toBe("[REDACTED]");
    expect(result.row?.["firstName"]).toBe("Ali");
    expect(result.rowsAffected).toBe(1);
    expect(result.auditId).toBeTruthy();
  });

  it("update/delete için row undefined döner", async () => {
    const pipeline = makePipeline();
    const result = await pipeline.recordWrite("update_row", "orders", "update", { id: 1 }, { status: "x" }, 2, undefined, Date.now());
    expect(result.row).toBeUndefined();
    expect(result.rowsAffected).toBe(2);
  });
});
