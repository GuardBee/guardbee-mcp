import { describe, it, expect } from "vitest";
import { createPrismaAdapter } from "../adapters/prisma";

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => row[k] === v);
}

function makeDelegate(rows: Record<string, unknown>[]) {
  return {
    findMany: async ({ take, where }: { take: number; where: Record<string, unknown> }) => {
      let result = rows;
      if (Object.keys(where).length > 0) {
        result = rows.filter((r) => matches(r, where));
      }
      return result.slice(0, take);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: rows.length + 1, ...data };
      rows.push(row);
      return row;
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (const row of rows) {
        if (matches(row, where)) {
          Object.assign(row, data);
          count++;
        }
      }
      return { count };
    },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      const before = rows.length;
      const remaining = rows.filter((r) => !matches(r, where));
      rows.length = 0;
      rows.push(...remaining);
      return { count: before - rows.length };
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

describe("createPrismaAdapter — insert()", () => {
  it("create({data}) çağırır ve eklenen satırı döner", async () => {
    const brand = makeDelegate([{ id: 1, name: "Acme" }]);
    const adapter = createPrismaAdapter({ brand });
    const row = await adapter.insert!("brand", { name: "Globex" });
    expect(row).toEqual({ id: 2, name: "Globex" });
  });

  it("bilinmeyen tablo → hata fırlatır", async () => {
    const adapter = createPrismaAdapter(mockPrisma);
    await expect(adapter.insert!("nonexistent", { a: 1 })).rejects.toThrow("Prisma model not found");
  });

  it("ISO date string Date objesine çevrilir", async () => {
    const dateDelegate = {
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: { data: unknown }) => data),
    };
    const adapter = createPrismaAdapter({ event: dateDelegate });
    await adapter.insert!("event", { createdAt: "2024-01-01T00:00:00Z" });
    const callArgs = (dateDelegate.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0];
    expect(callArgs.data["createdAt"]).toBeInstanceOf(Date);
  });
});

describe("createPrismaAdapter — update()", () => {
  it("updateMany çağırır, etkilenen satır sayısını döner", async () => {
    const user = makeDelegate([
      { id: 1, email: "a@b.com", status: "active" },
      { id: 2, email: "c@d.com", status: "active" },
    ]);
    const adapter = createPrismaAdapter({ user });
    const count = await adapter.update!("users", { status: "active" }, { status: "archived" });
    expect(count).toBe(2);
  });

  it("bilinmeyen tablo → hata fırlatır", async () => {
    const adapter = createPrismaAdapter(mockPrisma);
    await expect(adapter.update!("nonexistent", {}, { a: 1 })).rejects.toThrow("Prisma model not found");
  });
});

describe("createPrismaAdapter — delete()", () => {
  it("deleteMany çağırır, silinen satır sayısını döner", async () => {
    const user = makeDelegate([
      { id: 1, email: "a@b.com", status: "inactive" },
      { id: 2, email: "c@d.com", status: "active" },
    ]);
    const adapter = createPrismaAdapter({ user });
    const count = await adapter.delete!("users", { status: "inactive" });
    expect(count).toBe(1);
  });

  it("bilinmeyen tablo → hata fırlatır", async () => {
    const adapter = createPrismaAdapter(mockPrisma);
    await expect(adapter.delete!("nonexistent", { a: 1 })).rejects.toThrow("Prisma model not found");
  });
});

// vi mock için import
import { vi } from "vitest";
