import { describe, it, expect } from "vitest";
import { assertValidIdentifier, assertPositiveInteger, quoteIdentifier } from "../adapters/sql-utils";

describe("assertValidIdentifier", () => {
  it("geçerli identifier'ları kabul eder", () => {
    expect(() => assertValidIdentifier("users", "table")).not.toThrow();
    expect(() => assertValidIdentifier("_private", "column")).not.toThrow();
    expect(() => assertValidIdentifier("audit_logs2", "table")).not.toThrow();
  });

  it("SQL injection denemelerini reddeder", () => {
    expect(() => assertValidIdentifier("users; DROP TABLE users;--", "table")).toThrow(
      "Invalid table name"
    );
    expect(() => assertValidIdentifier("users\" OR \"1\"=\"1", "table")).toThrow();
    expect(() => assertValidIdentifier("id = 1 OR 1=1", "column")).toThrow("Invalid column name");
    expect(() => assertValidIdentifier("`col`", "column")).toThrow();
  });

  it("boş string'i reddeder", () => {
    expect(() => assertValidIdentifier("", "table")).toThrow();
  });

  it("rakamla başlayan identifier'ı reddeder", () => {
    expect(() => assertValidIdentifier("1table", "table")).toThrow();
  });
});

describe("assertPositiveInteger", () => {
  it("pozitif tam sayıları kabul eder", () => {
    expect(() => assertPositiveInteger(1, "limit")).not.toThrow();
    expect(() => assertPositiveInteger(200, "limit")).not.toThrow();
  });

  it("sıfır, negatif ve ondalık değerleri reddeder", () => {
    expect(() => assertPositiveInteger(0, "limit")).toThrow();
    expect(() => assertPositiveInteger(-5, "limit")).toThrow();
    expect(() => assertPositiveInteger(1.5, "limit")).toThrow();
  });
});

describe("quoteIdentifier", () => {
  it("identifier'ı verilen quote karakteriyle sarar", () => {
    expect(quoteIdentifier("users", '"')).toBe('"users"');
    expect(quoteIdentifier("users", "`")).toBe("`users`");
  });

  it("içindeki quote karakterini ikiye katlar", () => {
    expect(quoteIdentifier('weird"name', '"')).toBe('"weird""name"');
  });
});
