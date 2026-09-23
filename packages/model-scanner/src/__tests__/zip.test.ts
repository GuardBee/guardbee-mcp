import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, openSync, closeSync, statSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readZipEntries, extractZipEntry } from "../zip.js";
import { buildZip } from "./testFixtures.js";

const dirs: string[] = [];
function tempFile(name: string, data: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "gb-model-scanner-zip-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, data);
  return p;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("readZipEntries / extractZipEntry", () => {
  it("STORED (sıkıştırmasız) tek girişi doğru okur ve çıkarır", () => {
    const payload = Buffer.from("hello pickle bytes");
    const zipBuf = buildZip("archive/data.pkl", payload, 0);
    const path = tempFile("model.pt", zipBuf);
    const fileSize = statSync(path).size;
    const fd = openSync(path, "r");
    try {
      const entries = readZipEntries(fd, fileSize);
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe("archive/data.pkl");
      expect(entries[0].compressionMethod).toBe(0);

      const extracted = extractZipEntry(fd, entries[0]);
      expect(extracted?.toString("utf8")).toBe("hello pickle bytes");
    } finally {
      closeSync(fd);
    }
  });

  it("DEFLATE sıkıştırmalı girişi doğru çıkarır", () => {
    const payload = Buffer.from("x".repeat(500));
    const zipBuf = buildZip("archive/data.pkl", payload, 8);
    const path = tempFile("model.pt", zipBuf);
    const fileSize = statSync(path).size;
    const fd = openSync(path, "r");
    try {
      const entries = readZipEntries(fd, fileSize);
      const extracted = extractZipEntry(fd, entries[0]);
      expect(extracted?.equals(payload)).toBe(true);
    } finally {
      closeSync(fd);
    }
  });

  it("geçersiz bir zip'te boş dizi döndürür, atmaz", () => {
    const path = tempFile("not-a-zip.pt", Buffer.from("this is not a zip file at all"));
    const fileSize = statSync(path).size;
    const fd = openSync(path, "r");
    try {
      expect(() => readZipEntries(fd, fileSize)).not.toThrow();
      expect(readZipEntries(fd, fileSize)).toEqual([]);
    } finally {
      closeSync(fd);
    }
  });
});
