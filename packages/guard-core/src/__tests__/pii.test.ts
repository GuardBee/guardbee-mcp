import { describe, it, expect } from "vitest";
import { maskPiiInText, maskPiiInValue } from "../pii.js";

describe("maskPiiInText — checksum doğrulamalı", () => {
  it("geçerli TC kimliği maskeler", () => {
    const result = maskPiiInText("TC: 10000000146");
    expect(result).toBe("TC: [TC-KİMLİK]");
  });

  it("checksum'ı tutmayan 11 haneli sayıyı (sipariş no vb.) maskelemez", () => {
    const text = "Sipariş no: 12345678901";
    expect(maskPiiInText(text)).toBe(text);
  });

  it("geçerli IBAN'ı maskeler, kontrol hanesi yanlış olanı maskelemez", () => {
    expect(maskPiiInText("IBAN: TR330006100519786457841326")).toBe("IBAN: TR**[IBAN]");
    expect(maskPiiInText("IBAN: TR340006100519786457841326")).not.toContain("[IBAN]");
  });

  it("Luhn'u tutan kartı maskeler, tutmayan 16 haneli sayıyı maskelemez", () => {
    expect(maskPiiInText("Kart: 4111 1111 1111 1111")).toBe("Kart: ****-****-****-[KART]");
    expect(maskPiiInText("Takip: 4111 1111 1111 1112")).not.toContain("[KART]");
  });

  it("bir metindeki birden fazla PII türünü birlikte maskeler", () => {
    const result = maskPiiInText("10000000146 / ahmet@example.com");
    expect(result).toBe("[TC-KİMLİK] / ***@[EMAIL]");
  });
});

describe("maskPiiInValue", () => {
  it("iç içe JSON'daki geçerli PII'yi maskeler, geri kalanı korur", () => {
    const result = maskPiiInValue({
      musteri: { tc: "10000000146", siparis: "12345678901", adet: 3 },
    });
    expect(result).toEqual({
      musteri: { tc: "[TC-KİMLİK]", siparis: "12345678901", adet: 3 },
    });
  });
});

describe("maskPiiInText — custom replacer", () => {
  it("passes the pattern name and the validated match, skipping invalid ones", () => {
    const seen: string[] = [];
    const result = maskPiiInText("10000000146 12345678901 a@b.co", (name, match) => {
      seen.push(`${name}:${match}`);
      return `<${name}>`;
    });
    expect(result).toBe("<tc_kimlik> 12345678901 <email>");
    expect(seen).toEqual(["tc_kimlik:10000000146", "email:a@b.co"]);
  });
});
