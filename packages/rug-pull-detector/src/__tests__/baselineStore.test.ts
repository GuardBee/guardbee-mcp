import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveBaseline, loadBaseline, listBaselines, baselinePath } from "../baselineStore.js";
import type { ServerBaseline } from "../types.js";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "gb-rug-pull-store-"));
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeBaseline(serverId: string, target: string): ServerBaseline {
  return {
    serverId,
    target,
    capturedAt: "2026-01-01T00:00:00.000Z",
    tools: { x: { hash: "abc", firstSeen: "2026-01-01T00:00:00.000Z", snapshot: { name: "x" } } },
  };
}

describe("baselineStore", () => {
  it("kaydedip aynı içerikle geri okur", () => {
    const dir = tempDir();
    const baseline = makeBaseline("id1", "npx foo");
    saveBaseline(dir, baseline);
    expect(loadBaseline(dir, "id1")).toEqual(baseline);
  });

  it("var olmayan bir baseline için null döner, atmaz", () => {
    const dir = tempDir();
    expect(loadBaseline(dir, "nope")).toBeNull();
  });

  it("henüz oluşmamış bir dizin için de null döner", () => {
    expect(loadBaseline(join(tmpdir(), "does-not-exist-" + Date.now()), "id1")).toBeNull();
  });

  it("bozuk bir JSON dosyasında atmadan null döner", () => {
    const dir = tempDir();
    const p = baselinePath(dir, "corrupt");
    mkdirSync(dir, { recursive: true });
    writeFileSync(p, "{ not json");
    expect(loadBaseline(dir, "corrupt")).toBeNull();
  });

  it("listBaselines tüm kaydedilmiş baseline'ları döner", () => {
    const dir = tempDir();
    saveBaseline(dir, makeBaseline("id1", "server-a"));
    saveBaseline(dir, makeBaseline("id2", "server-b"));
    const all = listBaselines(dir).map((b) => b.target).sort();
    expect(all).toEqual(["server-a", "server-b"]);
  });

  it("dizin henüz yoksa listBaselines boş dizi döner", () => {
    expect(listBaselines(join(tmpdir(), "does-not-exist-" + Date.now()))).toEqual([]);
  });

  it("saveBaseline dizini gerekirse oluşturur", () => {
    const dir = join(tempDir(), "nested", "deeper");
    expect(existsSync(dir)).toBe(false);
    saveBaseline(dir, makeBaseline("id1", "x"));
    expect(existsSync(dir)).toBe(true);
  });
});
