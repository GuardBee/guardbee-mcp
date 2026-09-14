import { describe, it, expect } from "vitest";
import { redactParams } from "../redact.js";

describe("redactParams", () => {
  it("kısa string/number/boolean değerleri olduğu gibi bırakır", () => {
    const result = redactParams({ table: "users", limit: 50, verbose: true });
    expect(result).toEqual({ table: "users", limit: 50, verbose: true });
  });

  it("40 karakterden uzun bir string'i redakte eder", () => {
    const longValue = "x".repeat(41);
    const result = redactParams({ note: longValue });
    expect(result["note"]).toBe(`[redacted: string, 41 chars]`);
  });

  it("40 karakter veya daha kısa string'i redakte etmez", () => {
    const value = "x".repeat(40);
    const result = redactParams({ note: value });
    expect(result["note"]).toBe(value);
  });

  it("'content' anahtarını uzunluğa bakmaksızın redakte eder", () => {
    const result = redactParams({ content: "kısa" });
    expect(result["content"]).toBe("[redacted: string, 4 chars]");
  });

  it("'data' ve 'filter' anahtarlarını redakte eder", () => {
    const result = redactParams({
      data: { tcKimlik: "12345678901" },
      filter: { email: "a@b.com" },
    });
    expect(result["data"]).toBe("[redacted: object]");
    expect(result["filter"]).toBe("[redacted: object]");
  });

  it("hassas anahtarları case-insensitive yakalar", () => {
    const result = redactParams({ ApiKey: "sk-abcdefgh" });
    expect(result["ApiKey"]).toBe("[redacted: string, 11 chars]");
  });

  it("nested objeleri recursive redakte eder", () => {
    const result = redactParams({
      config: { table: "orders", password: "supersecret" },
    });
    expect(result["config"]).toEqual({
      table: "orders",
      password: "[redacted: string, 11 chars]",
    });
  });

  it("array içindeki uzun string'leri redakte eder", () => {
    const result = redactParams({ tags: ["short", "x".repeat(50)] });
    expect(result["tags"]).toEqual(["short", "[redacted: string, 50 chars]"]);
  });

  it("null/undefined değerleri olduğu gibi bırakır", () => {
    const result = redactParams({ optional: null });
    expect(result["optional"]).toBeNull();
  });

  it("boş/geçersiz params için boş obje döner", () => {
    expect(redactParams(undefined)).toEqual({});
    expect(redactParams(null)).toEqual({});
    expect(redactParams({})).toEqual({});
  });

  it("gerçekçi bir db-gateway insert_row çağrısını doğru redakte eder", () => {
    const result = redactParams({
      table: "users",
      data: { tcKimlik: "12345678901", firstName: "Ahmet" },
    });
    expect(result).toEqual({
      table: "users",
      data: "[redacted: object]",
    });
  });

  it("gerçekçi bir ai-code-scanner scan_text çağrısını doğru redakte eder", () => {
    const result = redactParams({
      content: "const x = eval(response.content);",
      label: "src/ai.ts",
    });
    expect(result["content"]).toMatch(/^\[redacted: string, \d+ chars\]$/);
    expect(result["label"]).toBe("src/ai.ts");
  });
});
