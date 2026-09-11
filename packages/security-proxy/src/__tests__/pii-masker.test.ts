import { describe, it, expect } from "vitest";
import { maskPiiInText, maskPiiInValue } from "../interceptors/pii-masker.js";

describe("maskPiiInText", () => {
  it("TC kimlik maskeler", () => {
    const result = maskPiiInText("Kullanıcı TC: 12345678901 kayıtlı");
    expect(result).toContain("[TC-KİMLİK]");
    expect(result).not.toContain("12345678901");
  });

  it("IBAN maskeler", () => {
    const result = maskPiiInText("IBAN: TR330006100519786457841326");
    expect(result).toContain("TR**[IBAN]");
  });

  it("e-posta maskeler", () => {
    const result = maskPiiInText("Email: ahmet@example.com");
    expect(result).toContain("***@[EMAIL]");
    expect(result).not.toContain("ahmet@example.com");
  });

  it("JWT token maskeler", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const result = maskPiiInText(`Token: ${jwt}`);
    expect(result).toContain("[JWT-TOKEN]");
    expect(result).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
  });

  it("temiz metni değiştirmez", () => {
    const text = "Sipariş #1234 hazır";
    expect(maskPiiInText(text)).toBe(text);
  });
});

describe("maskPiiInValue", () => {
  it("string'i maskeler", () => {
    const result = maskPiiInValue("ahmet@test.com");
    expect(result).toContain("***");
  });

  it("array içindeki stringleri maskeler", () => {
    const result = maskPiiInValue(["ahmet@test.com", "normal metin"]) as string[];
    expect(result[0]).toContain("***");
    expect(result[1]).toBe("normal metin");
  });

  it("iç içe objeleri maskeler", () => {
    const result = maskPiiInValue({
      user: { email: "ahmet@test.com", name: "Ahmet" },
    }) as { user: { email: string; name: string } };
    expect(result.user.email).toContain("***");
    expect(result.user.name).toBe("Ahmet");
  });

  it("number ve boolean'ı değiştirmez", () => {
    expect(maskPiiInValue(42)).toBe(42);
    expect(maskPiiInValue(true)).toBe(true);
    expect(maskPiiInValue(null)).toBe(null);
  });
});
