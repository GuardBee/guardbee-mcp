import { describe, it, expect } from "vitest";
import { piiScope } from "@guardbee/guard-core";
import { GatewayPipeline } from "../gateway/pipeline";
import { maskRow } from "../gateway/masker";
import { GatewayConfigSchema, loadConfig } from "../config";

const KEY = "ghp_aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY2zAb";
const rows = [
  {
    id: "o1",
    email: "ahmet@example.com",
    notes: `Müşteri ayse@example.com, TC 10000000146 ile aradı. Anahtar: ${KEY}`,
    tags: ["vip", "iletişim: ali@example.org"],
    meta: { comment: "IBAN TR330006100519786457841326" },
    createdAt: new Date("2026-10-15T10:00:00Z"),
  },
];

function rowsOf(overrides = {}) {
  const pipeline = new GatewayPipeline(loadConfig({ audit: { enabled: false, sink: "console" as const }, ...overrides }));
  return pipeline.process("query_table", "orders", {}, rows).then((result) => {
    if (!("rows" in result)) throw new Error("denied");
    return result.rows[0]!;
  });
}

describe("db-gateway piiScan", () => {
  it("is off by default: only field rules mask", async () => {
    const row = await rowsOf();
    expect(row["notes"]).toBe(rows[0]!.notes);
    expect(row["email"]).not.toBe("ahmet@example.com");
  });

  it("masks PII inside text columns no field rule covers, nested and in arrays", async () => {
    const row = await rowsOf({ piiScan: { enabled: true } });
    expect(row["notes"]).toBe("Müşteri ***@[EMAIL], TC [TC-KİMLİK] ile aradı. Anahtar: [API-KEY]");
    expect(row["tags"]).toEqual(["vip", "iletişim: ***@[EMAIL]"]);
    expect(row["meta"]).toEqual({ comment: "IBAN TR**[IBAN]" });
    expect(row["createdAt"]).toEqual(rows[0]!.createdAt);
  });

  it("a preset picks the detectors", async () => {
    const row = await rowsOf({ piiScan: { enabled: true, preset: "SECRETS" } });
    expect(row["notes"]).toBe("Müşteri ayse@example.com, TC 10000000146 ile aradı. Anahtar: [API-KEY]");
    const kvkk = await rowsOf({ piiScan: { enabled: true, preset: "KVKK", disable: ["email"] } });
    expect(kvkk["notes"]).toBe(`Müşteri ayse@example.com, TC [TC-KİMLİK] ile aradı. Anahtar: ${KEY}`);
  });

  it("an allow rule turns the scan off for that field", () => {
    const out = maskRow({ notes: "ayse@example.com" }, [{ field: "notes", strategy: "allow" }], "orders", piiScope());
    expect(out).toEqual({ notes: "ayse@example.com" });
  });

  it("config validation rejects an unknown preset or detector name", () => {
    expect(GatewayConfigSchema.safeParse({ piiScan: { preset: "GDPR" } }).success).toBe(false);
    const bad = GatewayConfigSchema.safeParse({ piiScan: { enable: ["tckn"] } });
    expect(bad.success).toBe(false);
    expect(bad.error!.issues[0]!.message).toBe('unknown PII detector "tckn"');
    expect(GatewayConfigSchema.safeParse({ piiScan: { preset: "KVKK", disable: ["email"] } }).success).toBe(true);
  });
});

describe("GATEWAY_PII_SCAN", () => {
  const withEnv = (value: string | undefined, fn: () => void) => {
    const before = process.env.GATEWAY_PII_SCAN;
    if (value === undefined) delete process.env.GATEWAY_PII_SCAN;
    else process.env.GATEWAY_PII_SCAN = value;
    try {
      fn();
    } finally {
      if (before === undefined) delete process.env.GATEWAY_PII_SCAN;
      else process.env.GATEWAY_PII_SCAN = before;
    }
  };

  it("turns the scan on, with a preset when it names one", () => {
    withEnv(undefined, () => expect(loadConfig().piiScan).toBeUndefined());
    withEnv("0", () => expect(loadConfig().piiScan).toBeUndefined());
    withEnv("true", () => expect(loadConfig().piiScan).toEqual({ enabled: true }));
    withEnv("kvkk", () => expect(loadConfig().piiScan).toEqual({ enabled: true, preset: "KVKK" }));
  });

  it("fails on an unknown preset instead of scanning with the wrong set", () => {
    withEnv("GDPR", () => expect(() => loadConfig()).toThrow());
  });
});

describe("piiScan org patterns", () => {
  const notes = [{ id: "n1", notes: "Dosya CL-123456, destek@acme.com.tr ve ayse@example.com" }];
  const run = (piiScan: object, data = notes) =>
    new GatewayPipeline(loadConfig({ audit: { enabled: false, sink: "console" as const }, piiScan: { enabled: true, ...piiScan } as never })).process(
      "query_table",
      "notes",
      {},
      data,
    );

  it("block masks the org's ids, allow keeps a public address", async () => {
    const result = await run({ blockPatterns: [{ pattern: "CL-\\d{6}", category: "CLIENT_NO" }], allowPatterns: ["destek@acme\\.com\\.tr"] });
    if (!("rows" in result)) throw new Error("denied");
    expect(result.rows[0]!["notes"]).toBe("Dosya <CLIENT_NO_1>, destek@acme.com.tr ve ***@[EMAIL]");
  });

  it("a block pattern over its time budget fails the query instead of returning unmasked rows", async () => {
    await expect(run({ blockPatterns: ["(a+)+b"] }, [{ id: "n1", notes: "a".repeat(40) }])).rejects.toThrow("took longer than");
  });

  it("config validation rejects a reserved category and an invalid regex", () => {
    expect(GatewayConfigSchema.safeParse({ piiScan: { blockPatterns: [{ pattern: "x", category: "EMAIL" }] } }).success).toBe(false);
    expect(GatewayConfigSchema.safeParse({ piiScan: { allowPatterns: ["("] } }).success).toBe(false);
  });
});
