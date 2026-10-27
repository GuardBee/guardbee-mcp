import { describe, it, expect } from "vitest";
import { MODEL_PII, maskPiiInText, maskPiiInValue, PERSONAL_DATA_CATEGORIES } from "../pii.js";
import { PII_DETECTORS, PII_PRESETS, piiScope, piiSelectionErrors, piiSelectionSchema } from "../presets.js";
import { gatewayPolicySchema } from "../policy.js";

// A fake token, assembled so secret scanners do not flag the test itself
const GITHUB_PAT = ["ghp", "aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY2zAb"].join("_");

const TEXT = [
  "TC 10000000146",
  "IBAN TR330006100519786457841326",
  "mail ahmet@example.com",
  "Adres: Atatürk Mah. 12. Sok. No:5",
  `anahtar ${GITHUB_PAT}`,
  "sunucu 192.168.1.10",
].join("\n");

const masked = (selection: Parameters<typeof piiScope>[0]) => {
  const names: string[] = [];
  maskPiiInText(TEXT, (name) => (names.push(name), `[${name}]`), piiScope(selection));
  return names;
};

describe("PII presets", () => {
  it("ALL is the default set: every detector except the opt-in ones", () => {
    expect(masked({})).toEqual(["github_pat", "address", "tc_kimlik", "iban", "email"]);
    expect(masked({ preset: "ALL" })).toEqual(masked({}));
    expect(PII_PRESETS.ALL).not.toContain("ip_address");
  });

  it("KVKK masks personal data and leaves credentials", () => {
    expect(masked({ preset: "KVKK" })).toEqual(["address", "tc_kimlik", "iban", "email"]);
    for (const name of PII_PRESETS.KVKK) expect([...PERSONAL_DATA_CATEGORIES, ...MODEL_PII]).toContain(name);
  });

  it("IDENTITY masks the address and birth date only", () => {
    expect(masked({ preset: "IDENTITY" })).toEqual(["address"]);
    expect(maskPiiInText("Doğum tarihi: 12.05.1990, TC 10000000146", undefined, piiScope({ preset: "IDENTITY" }))).toBe(
      "Doğum tarihi: [DOĞUM-TARİHİ], TC 10000000146",
    );
  });

  it("IDENTIFIERS masks numbers and handles, not the address or keys", () => {
    expect(masked({ preset: "IDENTIFIERS" })).toEqual(["tc_kimlik", "iban", "email"]);
  });

  it("SECRETS masks credentials only, none of them personal data", () => {
    expect(masked({ preset: "SECRETS" })).toEqual(["github_pat"]);
    expect(PII_PRESETS.SECRETS).toContain("private_key");
    expect(PII_PRESETS.SECRETS).toContain("api_key");
    expect(PII_PRESETS.SECRETS).toContain("jwt");
    for (const name of PII_PRESETS.SECRETS) expect(PERSONAL_DATA_CATEGORIES).not.toContain(name);
  });

  it("every preset names only real detectors", () => {
    for (const names of Object.values(PII_PRESETS)) for (const name of names) expect(PII_DETECTORS).toContain(name);
  });
});

describe("enable / disable", () => {
  it("enable adds a detector to a preset, opt-in ones included", () => {
    expect(masked({ preset: "SECRETS", enable: ["email", "ip_address"] })).toEqual(["github_pat", "email", "ip_address"]);
  });

  it("disable removes a detector, and wins over enable", () => {
    expect(masked({ disable: ["iban"] })).toEqual(["github_pat", "address", "tc_kimlik", "email"]);
    expect(masked({ preset: "KVKK", enable: ["email"], disable: ["email"] })).toEqual(["address", "tc_kimlik", "iban"]);
  });

  it("a detector outside the scope leaves its value as it was", () => {
    const out = maskPiiInValue({ tc: "10000000146", key: GITHUB_PAT }, undefined, piiScope({ preset: "SECRETS" }));
    expect(out).toEqual({ tc: "10000000146", key: "[API-KEY]" });
  });

  it("a plain set still only adds opt-in detectors to the default ones", () => {
    expect(maskPiiInText("192.168.1.10 TC 10000000146", undefined, new Set(["ip_address"]))).toBe("[IP] TC [TC-KİMLİK]");
  });
});

describe("validation", () => {
  it("rejects an unknown preset or detector name", () => {
    expect(piiSelectionErrors({ preset: "GDPR" as never, enable: ["tckn"], disable: ["emial"] })).toEqual([
      'unknown PII preset "GDPR" (one of ALL, KVKK, KVKK_SENSITIVE, IDENTITY, IDENTIFIERS, SECRETS)',
      'enable: unknown PII detector "tckn"',
      'disable: unknown PII detector "emial"',
    ]);
    expect(() => piiScope({ enable: ["tckn"] })).toThrow('unknown PII detector "tckn"');
  });

  it("the config schema fails on unknown names at their path", () => {
    const result = piiSelectionSchema.safeParse({ preset: "KVKK", disable: ["email", "tckn"] });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => [i.path.join("."), i.message])).toEqual([["disable.1", 'unknown PII detector "tckn"']]);
    expect(piiSelectionSchema.safeParse({ preset: "NOPE" }).success).toBe(false);
    expect(piiSelectionSchema.safeParse({ preset: "KVKK", extra: 1 }).success).toBe(false);
  });

  it("the gateway policy accepts a selection and per-upstream overrides, and rejects unknown names", () => {
    const ok = gatewayPolicySchema.safeParse({
      interceptors: { piiMasking: { enabled: true, preset: "KVKK", disable: ["address"], upstreams: { github: { preset: "SECRETS" } } } },
    });
    expect(ok.success).toBe(true);
    const bad = gatewayPolicySchema.safeParse({
      interceptors: { piiMasking: { enabled: true, enable: ["tckn"], upstreams: { crm: { disable: ["mail"] } } } },
    });
    expect(bad.success).toBe(false);
    expect(bad.error!.issues.map((i) => i.path.join("."))).toEqual(
      expect.arrayContaining(["interceptors.piiMasking.enable.0", "interceptors.piiMasking.upstreams.crm.disable.0"]),
    );
  });
});
