import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadCustomPatterns } from "../custom-patterns.js";
import { scanText } from "../scanner.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "guardbee-rules-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadCustomPatterns", () => {
  it("geçerli bir tek-kural dosyasını yükler", () => {
    writeFileSync(
      join(dir, "kvkk.json"),
      JSON.stringify({
        id: "kvkk_tc_kimlik_in_prompt",
        name: "TC Kimlik No interpolated into a prompt",
        category: "data-privacy",
        pattern: "\\btcKimlikNo\\b",
        flags: "gi",
        severity: "high",
        recommendation: "Mask before sending to the model.",
      })
    );

    const { patterns, errors } = loadCustomPatterns(dir);
    expect(errors).toEqual([]);
    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.id).toBe("kvkk_tc_kimlik_in_prompt");
  });

  it("bir dosyadaki kural dizisini yükler", () => {
    writeFileSync(
      join(dir, "many.json"),
      JSON.stringify([
        {
          id: "custom_one",
          name: "Custom One",
          category: "data-privacy",
          pattern: "custom1",
          severity: "low",
          recommendation: "x",
        },
        {
          id: "custom_two",
          name: "Custom Two",
          category: "prompt-injection",
          pattern: "custom2",
          severity: "medium",
          recommendation: "y",
        },
      ])
    );

    const { patterns, errors } = loadCustomPatterns(dir);
    expect(errors).toEqual([]);
    expect(patterns.map((p) => p.id).sort()).toEqual(["custom_one", "custom_two"]);
  });

  it("yüklenen kural gerçekten eşleşme buluyor", () => {
    writeFileSync(
      join(dir, "kvkk.json"),
      JSON.stringify({
        id: "kvkk_tc_kimlik_in_prompt",
        name: "TC Kimlik No interpolated into a prompt",
        category: "data-privacy",
        pattern: "\\btcKimlikNo\\b",
        severity: "high",
        recommendation: "Mask before sending to the model.",
      })
    );
    const { patterns } = loadCustomPatterns(dir);

    const findings = scanText("const p = `User: ${tcKimlikNo}`;", undefined, patterns);
    expect(findings.map((f) => f.patternId)).toContain("kvkk_tc_kimlik_in_prompt");
  });

  it("built-in bir id ile çakışan kuralı reddeder", () => {
    writeFileSync(
      join(dir, "bad.json"),
      JSON.stringify({
        id: "openai_dangerously_allow_browser",
        name: "Duplicate",
        category: "client-exposure",
        pattern: "x",
        severity: "low",
        recommendation: "x",
      })
    );

    const { patterns, errors } = loadCustomPatterns(dir);
    expect(patterns).toHaveLength(0);
    expect(errors[0]).toMatch(/collides/);
  });

  it("eksik alanı olan kuralı reddeder", () => {
    writeFileSync(join(dir, "bad.json"), JSON.stringify({ id: "x", name: "x" }));

    const { patterns, errors } = loadCustomPatterns(dir);
    expect(patterns).toHaveLength(0);
    expect(errors[0]).toMatch(/missing required/);
  });

  it("geçersiz regex içeren kuralı reddeder", () => {
    writeFileSync(
      join(dir, "bad.json"),
      JSON.stringify({
        id: "broken_regex",
        name: "Broken",
        category: "data-privacy",
        pattern: "(unterminated",
        severity: "low",
        recommendation: "x",
      })
    );

    const { patterns, errors } = loadCustomPatterns(dir);
    expect(patterns).toHaveLength(0);
    expect(errors[0]).toMatch(/invalid regex/);
  });

  it("bozuk JSON dosyasını hata olarak raporlar, çökmez", () => {
    writeFileSync(join(dir, "bad.json"), "{ not json");

    const { patterns, errors } = loadCustomPatterns(dir);
    expect(patterns).toHaveLength(0);
    expect(errors[0]).toMatch(/invalid JSON/);
  });

  it("dizin yoksa boş sonuç döner, çökmez", () => {
    const { patterns, errors } = loadCustomPatterns(join(dir, "does-not-exist"));
    expect(patterns).toEqual([]);
    expect(errors).toEqual([]);
  });
});
