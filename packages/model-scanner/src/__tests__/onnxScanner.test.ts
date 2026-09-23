import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { scanOnnxFile } from "../onnxScanner.js";

const dirs: string[] = [];
function tempFile(name: string, data: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "gb-model-scanner-onnx-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, data);
  return p;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("scanOnnxFile", () => {
  it("'..' içeren external_data location'ı yakalar", () => {
    const text = '"external_data": [{"location": "value=../../etc/passwd", "offset": "0"}]';
    const path = tempFile("evil.onnx", Buffer.from(text, "latin1"));
    const findings = scanOnnxFile(path);
    expect(findings.some((f) => f.patternId === "onnx_external_data_path_traversal")).toBe(true);
  });

  it("normal (traversal içermeyen) bir external_data location'ı yakalamaz", () => {
    const text = '"external_data": [{"location": "value=weights.bin", "offset": "0"}]';
    const path = tempFile("clean.onnx", Buffer.from(text, "latin1"));
    const findings = scanOnnxFile(path);
    expect(findings.some((f) => f.patternId === "onnx_external_data_path_traversal")).toBe(false);
  });

  it("external_data hiç geçmeyen bir dosyada bulgu döndürmez", () => {
    const path = tempFile("noexternal.onnx", Buffer.from("just some ordinary onnx protobuf bytes with op_type Conv"));
    expect(scanOnnxFile(path)).toEqual([]);
  });
});
