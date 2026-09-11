import { describe, it, expect } from "vitest";
import { applyStrategy, maskRow, maskRows } from "../gateway/masker";
import type { FieldRule } from "../config";

// ─── applyStrategy ───────────────────────────────────────────────────────────

describe("applyStrategy", () => {
  it("redact → [REDACTED]", () => {
    expect(applyStrategy("secret", "redact")).toBe("[REDACTED]");
    expect(applyStrategy(12345, "redact")).toBe("[REDACTED]");
  });

  it("allow → değer olduğu gibi geçer", () => {
    expect(applyStrategy("hello", "allow")).toBe("hello");
    expect(applyStrategy(42, "allow")).toBe(42);
  });

  it("hash → 16 karakterlik hex string döner", () => {
    const h = applyStrategy("test", "hash");
    expect(typeof h).toBe("string");
    expect((h as string).length).toBe(16);
    expect(/^[0-9a-f]+$/.test(h as string)).toBe(true);
  });

  it("hash deterministik", () => {
    expect(applyStrategy("abc", "hash")).toBe(applyStrategy("abc", "hash"));
  });

  it("mask → e-posta yerel kısmı kısaltılır", () => {
    expect(applyStrategy("ahmet@example.com", "mask")).toBe("ah***@example.com");
  });

  it("mask → kısa e-posta (1 karakter yerel)", () => {
    expect(applyStrategy("a@b.com", "mask")).toBe("a***@b.com");
  });

  it("mask → sadece rakam: telefon", () => {
    const result = applyStrategy("5301234567", "mask") as string;
    expect(result).toMatch(/^530\*+\d{2}$/);
  });

  it("mask → IBAN rakam+harf karışık", () => {
    const result = applyStrategy("TR320010009999901234567890", "mask") as string;
    expect(result).toContain("***");
  });

  it("null/undefined değerler olduğu gibi geçer", () => {
    expect(applyStrategy(null, "redact")).toBeNull();
    expect(applyStrategy(undefined, "mask")).toBeUndefined();
  });
});

// ─── maskRow ─────────────────────────────────────────────────────────────────

describe("maskRow", () => {
  const rules: FieldRule[] = [
    { field: "email", strategy: "mask" },
    { field: "tcKimlik", strategy: "redact" },
    { field: "passwordHash", strategy: "redact" },
    { field: "iban", strategy: "mask" },
  ];

  it("eşleşen field'lar maskelenir, diğerleri geçer", () => {
    const row = {
      id: "u1",
      email: "test@example.com",
      tcKimlik: "12345678901",
      firstName: "Ali",
    };
    const masked = maskRow(row, rules);
    expect(masked["id"]).toBe("u1");
    expect(masked["firstName"]).toBe("Ali");
    expect(masked["email"]).toBe("te***@example.com");
    expect(masked["tcKimlik"]).toBe("[REDACTED]");
  });

  it("tablo kısıtlı kural sadece o tabloda uygulanır", () => {
    const tableRules: FieldRule[] = [
      { field: "amount", strategy: "redact", table: "orders" },
    ];
    const row = { amount: 100 };
    expect(maskRow(row, tableRules, "orders")["amount"]).toBe("[REDACTED]");
    expect(maskRow(row, tableRules, "products")["amount"]).toBe(100);
  });

  it("nested obje recursive maskelenir", () => {
    const row = {
      user: { email: "x@y.com", name: "Ali" },
    };
    const masked = maskRow(row, rules);
    const user = masked["user"] as Record<string, unknown>;
    expect(user["email"]).toBe("x***@y.com");
    expect(user["name"]).toBe("Ali");
  });

  it("array içindeki objeler maskelenir", () => {
    const row = {
      contacts: [
        { email: "a@b.com" },
        { email: "c@d.com" },
      ],
    };
    const masked = maskRow(row, rules);
    const contacts = masked["contacts"] as Record<string, unknown>[];
    expect(contacts[0]?.["email"]).toBe("a***@b.com");
    expect(contacts[1]?.["email"]).toBe("c***@d.com");
  });

  it("glob pattern *Password* eşleşir", () => {
    const globRules: FieldRule[] = [{ field: "*Password*", strategy: "redact" }];
    const row = { userPassword: "secret", hashedPassword: "hash" };
    const masked = maskRow(row, globRules);
    expect(masked["userPassword"]).toBe("[REDACTED]");
    expect(masked["hashedPassword"]).toBe("[REDACTED]");
  });
});

// ─── maskRows ────────────────────────────────────────────────────────────────

describe("maskRows", () => {
  const rules: FieldRule[] = [{ field: "email", strategy: "mask" }];
  const rows = Array.from({ length: 10 }, (_, i) => ({
    id: i,
    email: `user${i}@example.com`,
  }));

  it("maxRows aşılınca truncated=true, slice uygulanır", () => {
    const result = maskRows(rows, rules, "users", 5);
    expect(result.truncated).toBe(true);
    expect(result.rows.length).toBe(5);
  });

  it("maxRows aşılmayınca truncated=false", () => {
    const result = maskRows(rows, rules, "users", 20);
    expect(result.truncated).toBe(false);
    expect(result.rows.length).toBe(10);
  });

  it("dönen satırlarda maskeleme uygulanmış", () => {
    const result = maskRows(rows, rules, "users", 10);
    expect((result.rows[0] as Record<string, unknown>)["email"]).toMatch(/\*\*\*/);
  });
});
