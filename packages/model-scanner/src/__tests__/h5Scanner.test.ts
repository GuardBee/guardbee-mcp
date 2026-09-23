import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { scanH5File } from "../h5Scanner.js";
import { HDF5_MAGIC } from "./testFixtures.js";

const dirs: string[] = [];
function tempFile(name: string, data: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "gb-model-scanner-h5-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, data);
  return p;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("scanH5File", () => {
  it("Lambda layer içeren bir model config'i yakalar", () => {
    const body = Buffer.from(JSON.stringify({ class_name: "Sequential", config: { layers: [{ class_name: "Lambda", config: { function: "gAWA..." } }] } }), "latin1");
    const path = tempFile("evil.h5", Buffer.concat([HDF5_MAGIC, body]));
    const findings = scanH5File(path);
    expect(findings.some((f) => f.patternId === "keras_lambda_layer" && f.severity === "critical")).toBe(true);
  });

  it("Lambda içermeyen normal bir model config'te bu bulguyu döndürmez", () => {
    const body = Buffer.from(JSON.stringify({ class_name: "Sequential", config: { layers: [{ class_name: "Dense" }] } }), "latin1");
    const path = tempFile("clean.h5", Buffer.concat([HDF5_MAGIC, body]));
    const findings = scanH5File(path);
    expect(findings.some((f) => f.patternId === "keras_lambda_layer")).toBe(false);
  });

  it("HDF5 imzası olmayan bir .h5 dosyasını extension_mismatch olarak yakalar", () => {
    const path = tempFile("fake.h5", Buffer.from("not actually hdf5 at all"));
    const findings = scanH5File(path);
    expect(findings[0]).toMatchObject({ patternId: "h5_extension_mismatch", severity: "high" });
  });
});
