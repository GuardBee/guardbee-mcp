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
