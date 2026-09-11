import { describe, it, expect } from "vitest";
import { RoleResolver } from "../rbac";
import { loadConfig } from "../config";

function makeResolver(activeRole?: string, roles = defaultRoles()) {
  const config = loadConfig({ activeRole, roles });
  return new RoleResolver(config);
}

function defaultRoles() {
  return [
    {
      name: "ai-agent",
      allowTables: ["products", "orders"],
      maxRows: 5,
    },
    {
      name: "analyst",
      denyTables: ["audit_logs"],
      fieldRules: [{ field: "email", strategy: "allow" as const }],
    },
    {
      name: "admin",
      // kısıtlama yok
    },
  ];
}

describe("RoleResolver — tablo erişimi", () => {
  it("aktif rol yoksa her şey açık", () => {
    const r = makeResolver(undefined);
    expect(r.checkTableAccess("users").allowed).toBe(true);
    expect(r.checkTableAccess("audit_logs").allowed).toBe(true);
  });

  it("ai-agent: allowTables dışındaki tablo engellenir", () => {
    const r = makeResolver("ai-agent");
    expect(r.checkTableAccess("users").allowed).toBe(false);
    expect(r.checkTableAccess("products").allowed).toBe(true);
    expect(r.checkTableAccess("orders").allowed).toBe(true);
  });

  it("analyst: denyTables'daki tablo engellenir", () => {
    const r = makeResolver("analyst");
    expect(r.checkTableAccess("audit_logs").allowed).toBe(false);
    expect(r.checkTableAccess("users").allowed).toBe(true);
  });

  it("admin: hiçbir kısıtlama yok", () => {
    const r = makeResolver("admin");
    expect(r.checkTableAccess("users").allowed).toBe(true);
    expect(r.checkTableAccess("audit_logs").allowed).toBe(true);
  });

  it("bulunamayan rol: uyarı verir ama engelleme yapmaz", () => {
    const r = makeResolver("unknown-role");
    expect(r.role).toBeNull();
    expect(r.checkTableAccess("users").allowed).toBe(true);
  });
});

describe("RoleResolver — filterTables", () => {
  const allTables = ["users", "orders", "products", "audit_logs"];

  it("ai-agent: sadece allowTables görünür", () => {
    const r = makeResolver("ai-agent");
    expect(r.filterTables(allTables).sort()).toEqual(["orders", "products"]);
  });

  it("analyst: denyTables gizlenir", () => {
    const r = makeResolver("analyst");
    expect(r.filterTables(allTables)).not.toContain("audit_logs");
    expect(r.filterTables(allTables)).toContain("users");
  });

  it("rol yoksa tüm tablolar görünür", () => {
    const r = makeResolver(undefined);
    expect(r.filterTables(allTables)).toEqual(allTables);
  });
});

describe("RoleResolver — mergedFieldRules", () => {
  it("rol field kuralı yoksa global kurallar döner", () => {
    const config = loadConfig({ activeRole: "ai-agent", roles: defaultRoles() });
    const r = new RoleResolver(config);
    expect(r.mergedFieldRules).toEqual(config.fieldRules);
  });

  it("rol field kuralı global kurallara göre önce gelir", () => {
    const config = loadConfig({ activeRole: "analyst", roles: defaultRoles() });
    const r = new RoleResolver(config);
    // analyst rolünde email → allow, global'de email → mask
    // merged rules'da ilk email kuralı 'allow' olmalı
    const emailRule = r.mergedFieldRules.find((rule) => rule.field === "email");
    expect(emailRule?.strategy).toBe("allow");
  });

  it("rol yoksa global kurallar", () => {
    const config = loadConfig({ roles: defaultRoles() });
    const r = new RoleResolver(config);
    expect(r.mergedFieldRules).toEqual(config.fieldRules);
  });
});

describe("RoleResolver — effectiveMaxRows", () => {
  it("rol maxRows ayarlıysa onu kullanır", () => {
    const r = makeResolver("ai-agent");
    expect(r.effectiveMaxRows()).toBe(5);
    expect(r.effectiveMaxRows(100)).toBe(5); // tablo kuralı görmezden gelir
  });

  it("rol maxRows yoksa tablo kuralını kullanır", () => {
    const r = makeResolver("analyst");
    expect(r.effectiveMaxRows(25)).toBe(25);
  });

  it("ikisi de yoksa global defaultMaxRows (50)", () => {
    const r = makeResolver("analyst");
    expect(r.effectiveMaxRows()).toBe(50);
  });
});
