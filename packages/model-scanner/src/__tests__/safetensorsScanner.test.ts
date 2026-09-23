import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { scanSafetensorsFile } from "../safetensorsScanner.js";
import { buildSafetensors } from "./testFixtures.js";

const dirs: string[] = [];
function tempFile(name: string, data: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "gb-model-scanner-st-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, data);
  return p;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("scanSafetensorsFile", () => {
  it("geçerli bir dosyada bulgu döndürmez", () => {
    const buf = buildSafetensors({ "weight": { dtype: "F32", shape: [4, 4], data_offsets: [0, 64] } }, 64);
    const path = tempFile("model.safetensors", buf);
    expect(scanSafetensorsFile(path)).toEqual([]);
  });

  it("pickle imzasıyla başlayan bir .safetensors dosyasını disguised olarak yakalar", () => {
    const buf = Buffer.concat([Buffer.from([0x80, 4, 0x63]), Buffer.from("os\nsystem\n.")]);
    const path = tempFile("evil.safetensors", buf);
    const findings = scanSafetensorsFile(path);
    expect(findings[0]).toMatchObject({ patternId: "safetensors_disguised_binary", severity: "critical" });
  });

  it("zip imzasıyla başlayan bir .safetensors dosyasını disguised olarak yakalar", () => {
    const buf = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);
    const path = tempFile("evil2.safetensors", buf);
    const findings = scanSafetensorsFile(path);
    expect(findings[0]).toMatchObject({ patternId: "safetensors_disguised_binary" });
  });

  it("dosya boyutunu aşan header uzunluğunu yakalar", () => {
    const lenBuf = Buffer.alloc(8);
    lenBuf.writeBigUInt64LE(BigInt(1_000_000), 0);
    const path = tempFile("bad-header.safetensors", Buffer.concat([lenBuf, Buffer.alloc(10)]));
    const findings = scanSafetensorsFile(path);
    expect(findings[0]).toMatchObject({ patternId: "safetensors_invalid_header_length", severity: "high" });
  });

  it("geçersiz JSON header'ı yakalar", () => {
    const badJson = Buffer.from("{not valid json", "utf8");
    const lenBuf = Buffer.alloc(8);
    lenBuf.writeBigUInt64LE(BigInt(badJson.length), 0);
    const path = tempFile("bad-json.safetensors", Buffer.concat([lenBuf, badJson]));
    const findings = scanSafetensorsFile(path);
    expect(findings[0]).toMatchObject({ patternId: "safetensors_invalid_json_header" });
  });

  it("veri bölümünü aşan tensor offset'lerini yakalar", () => {
    const buf = buildSafetensors({ "weight": { dtype: "F32", shape: [100, 100], data_offsets: [0, 999999] } }, 64);
    const path = tempFile("overflow.safetensors", buf);
    const findings = scanSafetensorsFile(path);
    expect(findings.some((f) => f.patternId === "safetensors_offset_out_of_bounds")).toBe(true);
  });

  it("bilinmeyen bir dtype'ı low severity ile işaretler", () => {
    const buf = buildSafetensors({ "weight": { dtype: "WEIRD9", shape: [1], data_offsets: [0, 4] } }, 4);
    const path = tempFile("weird-dtype.safetensors", buf);
    const findings = scanSafetensorsFile(path);
    expect(findings.some((f) => f.patternId === "safetensors_unknown_dtype" && f.severity === "low")).toBe(true);
  });

  it("__metadata__ içindeki şüpheli anahtar kelimeleri yakalar", () => {
    const header = {
      __metadata__: { note: "import os; os.system('rm -rf /')" },
      weight: { dtype: "F32", shape: [1], data_offsets: [0, 4] },
    };
    const headerBuf = Buffer.from(JSON.stringify(header), "utf8");
    const lenBuf = Buffer.alloc(8);
    lenBuf.writeBigUInt64LE(BigInt(headerBuf.length), 0);
    const path = tempFile("suspicious-meta.safetensors", Buffer.concat([lenBuf, headerBuf, Buffer.alloc(4)]));
    const findings = scanSafetensorsFile(path);
    expect(findings.some((f) => f.patternId === "safetensors_suspicious_metadata")).toBe(true);
  });
});
