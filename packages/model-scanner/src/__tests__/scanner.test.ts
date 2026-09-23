import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { scanModelFile, scanDirectory } from "../scanner.js";
import { buildZip, buildPickle, buildSafetensors, HDF5_MAGIC } from "./testFixtures.js";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "gb-model-scanner-int-"));
  dirs.push(dir);
  return dir;
}
function writeIn(dir: string, name: string, data: Buffer): string {
  const p = join(dir, name);
  writeFileSync(p, data);
  return p;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("scanModelFile — format dispatch", () => {
  it(".pkl dosyasında tehlikeli global'i bulur", () => {
    const dir = tempDir();
    const path = writeIn(dir, "evil.pkl", buildPickle(["os", "system"]));
    const { findings, skipped, format } = scanModelFile(path);
    expect(skipped).toBe(false);
    expect(format).toBe("pickle");
    expect(findings.some((f) => f.patternId.includes("os_system"))).toBe(true);
  });

  it("pickle gibi görünmeyen bir .bin dosyasını skip eder", () => {
    const dir = tempDir();
    const path = writeIn(dir, "weights.bin", Buffer.from("this is just raw tensor bytes not a pickle stream"));
    const { skipped, format } = scanModelFile(path);
    expect(skipped).toBe(true);
    expect(format).toBe("not-a-pickle");
  });

  it("zip tabanlı PyTorch checkpoint'inde data.pkl içindeki tehlikeli global'i bulur", () => {
    const dir = tempDir();
    const pickle = buildPickle(["subprocess", "Popen"]);
    const zipBuf = buildZip("archive/data.pkl", pickle, 0);
    const path = writeIn(dir, "checkpoint.pt", zipBuf);
    const { findings, skipped, format } = scanModelFile(path);
    expect(skipped).toBe(false);
    expect(format).toBe("pytorch-zip");
    expect(findings.some((f) => f.patternId.includes("subprocess_Popen"))).toBe(true);
  });

  it("data.pkl içermeyen bir zip'i bilgilendirici bulgu ile işaretler", () => {
    const dir = tempDir();
    const zipBuf = buildZip("weights.bin", Buffer.from("raw tensor data"), 0);
    const path = writeIn(dir, "other.pt", zipBuf);
    const { findings, skipped, format } = scanModelFile(path);
    expect(skipped).toBe(false);
    expect(format).toBe("zip-unrecognized");
    expect(findings[0].patternId).toBe("zip_no_data_pkl");
  });

  it("geçerli bir .safetensors dosyasında bulgu döndürmez", () => {
    const dir = tempDir();
    const buf = buildSafetensors({ w: { dtype: "F32", shape: [1], data_offsets: [0, 4] } }, 4);
    const path = writeIn(dir, "model.safetensors", buf);
    const { findings, skipped, format } = scanModelFile(path);
    expect(skipped).toBe(false);
    expect(format).toBe("safetensors");
    expect(findings).toEqual([]);
  });

  it("pickle imzasıyla başlayan bir .safetensors dosyasını yakalar (uzantı sniff'ten önceliklidir)", () => {
    const dir = tempDir();
    const pickle = buildPickle(["os", "system"]);
    const path = writeIn(dir, "disguised.safetensors", pickle);
    const { findings, format } = scanModelFile(path);
    expect(format).toBe("safetensors");
    expect(findings[0].patternId).toBe("safetensors_disguised_binary");
  });

  it("Lambda layer olmayan geçerli bir .h5 dosyasında code-execution bulgusu döndürmez", () => {
    const dir = tempDir();
    const body = Buffer.from(JSON.stringify({ class_name: "Sequential" }), "latin1");
    const path = writeIn(dir, "model.h5", Buffer.concat([HDF5_MAGIC, body]));
    const { findings, format } = scanModelFile(path);
    expect(format).toBe("hdf5");
    expect(findings.some((f) => f.category === "code-execution")).toBe(false);
  });

  it("desteklenmeyen bir uzantıyı skip eder", () => {
    const dir = tempDir();
    const path = writeIn(dir, "readme.txt", Buffer.from("hello"));
    const { skipped, format } = scanModelFile(path);
    expect(skipped).toBe(true);
    expect(format).toBe("unsupported");
  });
});

describe("scanDirectory", () => {
  it("bir dizindeki birden fazla model dosyasını tarar ve sayaçları doğru tutar", () => {
    const dir = tempDir();
    writeIn(dir, "evil.pkl", buildPickle(["os", "system"]));
    writeIn(dir, "clean.safetensors", buildSafetensors({ w: { dtype: "F32", shape: [1], data_offsets: [0, 4] } }, 4));
    writeIn(dir, "readme.txt", Buffer.from("not a model"));

    const result = scanDirectory(dir);
    expect(result.scannedFiles).toBe(2);
    expect(result.skippedFiles).toBe(1);
    expect(result.findings.some((f) => f.patternId.includes("os_system"))).toBe(true);
  });
});
