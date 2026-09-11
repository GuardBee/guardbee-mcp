import { describe, it, expect } from "vitest";
import { createPrismaAdapter } from "../adapters/prisma";

function makeDelegate(rows: Record<string, unknown>[]) {
  return {
    findMany: async ({ take, where }: { take: number; where: Record<string, unknown> }) => {
      let result = rows;
      if (Object.keys(where).length > 0) {
        result = rows.filter((r) =>
          Object.entries(where).every(([k, v]) => r[k] === v)
        );
      }
      return result.slice(0, take);
    },
  };
}

const mockPrisma = {
  user: makeDelegate([
    { id: 1, email: "a@b.com", status: "active" },
    { id: 2, email: "c@d.com", status: "inactive" },
  ]),
  auditLog: makeDelegate([{ id: 1, action: "login" }]),
  order: makeDelegate([{ id: 1, amount: 100 }]),
  brand: makeDelegate([{ id: 1, name: "Acme" }]),
};

describe("createPrismaAdapter — tables()", () => {
  it("tüm model accessor adlarını döner", async () => {
    const adapter = createPrismaAdapter(mockPrisma);
    const tables = await adapter.tables();
    expect(tables.sort()).toEqual(["auditLog", "brand", "order", "user"]);
  });
});

describe("createPrismaAdapter — query() model key resolution", () => {
  const adapter = createPrismaAdapter(mockPrisma);

  it("doğrudan eşleşme: 'user' → prisma.user", async () => {
    const rows = await adapter.query("user", {}, 10);
    expect(rows.length).toBe(2);
  });

  it("plural → singular: 'users' → prisma.user", async () => {
    const rows = await adapter.query("users", {}, 10);
    expect(rows.length).toBe(2);
  });

  it("snake_case camelCase singular: 'audit_logs' → prisma.auditLog", async () => {
    const rows = await adapter.query("audit_logs", {}, 10);
    expect(rows).toEqual([{ id: 1, action: "login" }]);
  });

  it("'orders' → prisma.order", async () => {
    const rows = await adapter.query("orders", {}, 10);
    expect(rows).toEqual([{ id: 1, amount: 100 }]);
  });

  it("bilinmeyen tablo → hata fırlatır", async () => {
    await expect(adapter.query("nonexistent", {}, 10)).rejects.toThrow(
      "Prisma model not found"
    );
  });
});

describe("createPrismaAdapter — query() filter ve limit", () => {
  const adapter = createPrismaAdapter(mockPrisma);

  it("limit uygulanır", async () => {
    const rows = await adapter.query("users", {}, 1);
    expect(rows.length).toBe(1);
  });

  it("filter eşleşen satırları döner", async () => {
    const rows = await adapter.query("users", { status: "active" }, 10);
    expect(rows.length).toBe(1);
    expect(rows[0]?.["status"]).toBe("active");
  });

  it("filter eşleşmeyince boş dizi döner", async () => {
    const rows = await adapter.query("users", { status: "banned" }, 10);
    expect(rows).toEqual([]);
  });

  it("ISO date string Date objesine çevrilir", async () => {
    const dateDelegate = {
      findMany: vi.fn(async () => []),
    };
    const prismaWithDate = { event: dateDelegate };
    const a = createPrismaAdapter(prismaWithDate);
    await a.query("event", { createdAt: "2024-01-01T00:00:00Z" }, 10);
    const callArgs = (dateDelegate.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }] | undefined)?.[0];
    expect(callArgs?.where?.["createdAt"]).toBeInstanceOf(Date);
  });
});

// vi mock için import
import { vi } from "vitest";
