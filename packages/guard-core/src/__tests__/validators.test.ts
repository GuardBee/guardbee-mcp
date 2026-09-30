import { describe, it, expect } from "vitest";
import { isValidIban, isValidLuhn, isValidTcKimlik, isValidTrPhone, isValidVkn } from "../validators.js";

describe("isValidTcKimlik", () => {
  it("geçerli TC kimlik numarasını kabul eder", () => {
    expect(isValidTcKimlik("10000000146")).toBe(true);
  });

  it("checksum'ı tutmayan 11 haneli sayıyı reddeder", () => {
    expect(isValidTcKimlik("12345678901")).toBe(false);
  });

  it("0 ile başlayan veya 11 hane olmayan girdiyi reddeder", () => {
    expect(isValidTcKimlik("00000000146")).toBe(false);
    expect(isValidTcKimlik("1000000014")).toBe(false);
  });
});

describe("isValidLuhn", () => {
  it("geçerli kart numarasını kabul eder", () => {
    expect(isValidLuhn("4111 1111 1111 1111")).toBe(true);
    expect(isValidLuhn("4111-1111-1111-1111")).toBe(true);
  });

  it("Luhn'u tutmayan numarayı reddeder", () => {
    expect(isValidLuhn("4111111111111112")).toBe(false);
  });
});

describe("isValidIban", () => {
  it("geçerli TR IBAN'ı kabul eder (boşluklu ve tireli)", () => {
    expect(isValidIban("TR330006100519786457841326")).toBe(true);
    expect(isValidIban("TR33 0006 1005 1978 6457 8413 26")).toBe(true);
    expect(isValidIban("TR33-0006-1005-1978-6457-8413-26")).toBe(true);
  });

  it("kontrol hanesi yanlış IBAN'ı reddeder", () => {
    expect(isValidIban("TR340006100519786457841326")).toBe(false);
  });
});

describe("isValidVkn", () => {
  it("accepts a valid tax number and rejects a wrong check digit", () => {
    expect(isValidVkn("1234567890")).toBe(true);
    expect(isValidVkn("1234567891")).toBe(false);
    expect(isValidVkn("123456789")).toBe(false);
  });
});

describe("isValidTrPhone", () => {
  it("accepts mobile, landline and 850 numbers with any prefix", () => {
    for (const phone of ["0532 123 45 67", "+90 532 123 45 67", "00905321234567", "5321234567", "0212 555 12 34", "0850 222 00 00"]) {
      expect(isValidTrPhone(phone), phone).toBe(true);
    }
  });

  it("rejects 10-digit runs that cannot be a Turkish number", () => {
    for (const other of ["1234567890", "0123456789", "9012345678", "2012345678"]) {
      expect(isValidTrPhone(other), other).toBe(false);
    }
  });
});
