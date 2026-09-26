import { describe, it, expect } from "vitest";
import { hashTool, canonicalJson, serverIdFromTarget } from "../hashing.js";

describe("canonicalJson", () => {
  it("key sırasından bağımsız aynı çıktıyı üretir", () => {
    const a = canonicalJson({ b: 1, a: 2, c: { y: 1, x: 2 } });
    const b = canonicalJson({ a: 2, c: { x: 2, y: 1 }, b: 1 });
    expect(a).toBe(b);
  });

  it("array sırasını korur (sadece object key'leri sıralar)", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });
});

describe("hashTool", () => {
  const base = { name: "get_weather", description: "Returns weather", inputSchema: { type: "object" } };

  it("aynı tool için deterministik aynı hash'i üretir", () => {
    expect(hashTool(base)).toBe(hashTool({ ...base }));
  });

  it("description değişirse hash değişir", () => {
    expect(hashTool(base)).not.toBe(hashTool({ ...base, description: "Different" }));
  });

  it("inputSchema değişirse hash değişir", () => {
    expect(hashTool(base)).not.toBe(hashTool({ ...base, inputSchema: { type: "object", properties: { x: {} } } }));
  });

  it("annotations değişirse hash değişir (destructiveHint flip)", () => {
    const withAnnotation = { ...base, annotations: { destructiveHint: false } };
    const flipped = { ...base, annotations: { destructiveHint: true } };
    expect(hashTool(withAnnotation)).not.toBe(hashTool(flipped));
  });

  it("key sırası farklı ama içerik aynı iki schema aynı hash'i üretir", () => {
    const t1 = { ...base, inputSchema: { type: "object", properties: { a: {}, b: {} } } };
    const t2 = { ...base, inputSchema: { properties: { b: {}, a: {} }, type: "object" } };
    expect(hashTool(t1)).toBe(hashTool(t2));
  });
});

describe("serverIdFromTarget", () => {
  it("aynı target için deterministik aynı id'yi üretir", () => {
    expect(serverIdFromTarget("npx -y @foo/bar")).toBe(serverIdFromTarget("npx -y @foo/bar"));
  });

  it("farklı target'lar farklı id üretir", () => {
    expect(serverIdFromTarget("npx -y @foo/bar")).not.toBe(serverIdFromTarget("npx -y @foo/baz"));
  });
});
