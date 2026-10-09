import { describe, expect, it } from "vitest";
import { findHighEntropy, looksRandom, shannonEntropy } from "../entropy.js";
import { scanText } from "../scanner.js";

/** Deterministic pseudo-random strings, built at runtime so the repo's secret scan ignores this file. */
function random(length: number, alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", seed = 7): string {
  let state = seed;
  let out = "";
  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) % 2147483648;
    // The high bits: a power-of-two LCG's low bits cycle quickly
    out += alphabet[Math.floor(state / 65536) % alphabet.length];
  }
  return out;
}

const KEY = random(40);
const HEX = random(64, "0123456789abcdef", 11);
const ids = (text: string, path?: string) => scanText(text, path).map((f) => f.patternId);

describe("shannonEntropy", () => {
  it("is 0 for one repeated character and log2(n) for n distinct ones", () => {
    expect(shannonEntropy("aaaa")).toBe(0);
    expect(shannonEntropy("abcd")).toBe(2);
    expect(shannonEntropy(KEY)).toBeGreaterThan(4);
  });

  it("tells random values from words", () => {
    expect(looksRandom(KEY).random).toBe(true);
    expect(looksRandom(HEX).random).toBe(true);
    expect(looksRandom("correct-horse-battery-staple").random).toBe(false);
    expect(looksRandom("deadbeefdeadbeef").random).toBe(false); // short hex
    expect(looksRandom("ThisIsMyPasswordForTheDatabase").random).toBe(false);
  });
});

describe("high-entropy secrets", () => {
  it("finds unquoted .env values, YAML and JSON, under names the provider rules do not know", () => {
    expect(ids(`WEBHOOK_SIGNING_SECRET=${KEY}\n`)).toEqual(["high_entropy_secret"]);
    expect(ids(`stripe:\n  client_secret: ${KEY}\n`)).toEqual(["high_entropy_secret"]);
    expect(ids(`{"internalApiKey": "${KEY}"}`)).toEqual(["high_entropy_secret"]);
    expect(ids(`SESSION_SALT=${HEX}\n`)).toEqual(["high_entropy_secret"]);
  });

  it("reports the value's location, redacted, with a fingerprint", () => {
    const [finding] = scanText(`# config\nAUTH_TOKEN=${KEY}\n`, "app.env");
    expect(finding).toMatchObject({ line: 2, column: 12, severity: "medium", patternName: 'High-entropy value assigned to "AUTH_TOKEN"' });
    expect(JSON.stringify(finding)).not.toContain(KEY);
  });

  it("ignores public, hash, id and url names, placeholders and references", () => {
    expect(ids(`STRIPE_PUBLISHABLE_KEY=${KEY}\n`)).toEqual([]);
    expect(ids(`TOKEN_HASH=${HEX}\n`)).toEqual([]);
    expect(ids(`AUTH_CLIENT_ID=${KEY}\n`)).toEqual([]);
    expect(ids(`SECRET=${"x".repeat(32)}\n`)).toEqual([]);
    expect(ids(`API_SECRET=\${API_SECRET}\n`)).toEqual([]);
    expect(ids(`PASSWORD=correct-horse-battery-staple\n`)).toEqual([]);
  });

  it("does not report a value a provider rule already found", () => {
    const token = ["ghp", random(36, undefined, 3)].join("_");
    expect(ids(`GITHUB_TOKEN=${token}\n`)).toEqual(["github_pat"]);
  });

  it("is low in test files, respects suppression markers, and can be turned off", () => {
    expect(scanText(`AUTH_TOKEN=${KEY}\n`, "src/__tests__/a.test.ts")[0]!.severity).toBe("low");
    expect(ids(`AUTH_TOKEN=${KEY} # gitleaks:allow\n`)).toEqual([]);
    expect(scanText(`AUTH_TOKEN=${KEY}\n`, "a.env", "a.env", { entropy: false })).toEqual([]);
  });

  it("finds each assignment once", () => {
    expect(findHighEntropy(`A_TOKEN=${KEY}\nB_SECRET=${HEX}\n`).map((hit) => hit.name)).toEqual(["A_TOKEN", "B_SECRET"]);
  });
});
