import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { grade } from "../finding.js";
import { finding } from "../finding.js";
import { RULES } from "../rules.js";
import { scanPath } from "../scanner.js";
import { buildAsar, buildElf64, buildFuseBinary, buildMachO64 } from "./testFixtures.js";

const ids = (fs: { patternId: string }[]) => fs.map((f) => f.patternId).sort();
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "rs-scan-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function write(root: string, files: Record<string, string | Buffer>): void {
  for (const [p, data] of Object.entries(files)) {
    const full = join(root, ...p.split("/"));
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, data);
  }
}

const minified = Array.from({ length: 300 }, (_, i) => `function a${i}(b){return b+${i}}`).join(";");

describe("scanPath", () => {
  it("scans a web build output directory and skips node_modules", () => {
    const root = tmp();
    write(root, {
      "dist/assets/index-3f9a.js": `${minified}\n//# sourceMappingURL=index-3f9a.js.map`,
      "dist/assets/index-3f9a.js.map": JSON.stringify({ version: 3, mappings: "AAAA", sources: ["src/App.tsx"], sourcesContent: ["export default 1"] }),
      "node_modules/lib/index.js": 'fetch("http://localhost:1")',
    });
    const r = scanPath(root);
    expect(r.kinds).toEqual(["web"]);
    expect(ids(r.findings)).toEqual(["sourcemap_embeds_source"]);
    expect(r.grade).toBe("F");
    expect(r.scannedFiles).toBe(2);
  });

  it("finds native binaries by magic bytes regardless of extension", () => {
    const root = tmp();
    write(root, {
      "bin/server": buildElf64({ type: "exec", sections: [{ name: ".debug_info" }], extra: "__stack_chk_fail" }),
      "README.txt": "not a binary",
    });
    const r = scanPath(root);
    expect(r.kinds).toEqual(["native"]);
    expect(ids(r.findings)).toEqual(["native_debug_info", "native_no_pie"]);
  });

  it("treats an .app with Electron Framework as one unit: fuses, ASAR and main executable", () => {
    const root = tmp();
    const app = join(root, "Demo.app");
    write(app, {
      "Contents/Frameworks/Electron Framework.framework/Electron Framework": buildFuseBinary("01001100"),
      "Contents/Resources/app.asar": buildAsar({ "package.json": "{}", "main.js": minified }),
      "Contents/MacOS/Demo": buildMachO64({ signature: { flags: 0x2 } }),
    });
    const r = scanPath(root);
    expect(ids(r.findings)).toEqual(["native_adhoc_signed", "native_no_hardened_runtime"]);
    expect(r.kinds.sort()).toEqual(["electron", "native"]);
    expect(r.notes.join("\n")).toContain("RunAsNode=off");
  });

  it("scans a single file target", () => {
    const root = tmp();
    write(root, { "app.js.map": JSON.stringify({ version: 3, mappings: "", sources: ["a.ts"] }) });
    expect(ids(scanPath(join(root, "app.js.map")).findings)).toEqual(["sourcemap_shipped"]);
  });

  it("notes unrecognised single files instead of failing", () => {
    const root = tmp();
    write(root, { "notes.txt": "hello" });
    const r = scanPath(join(root, "notes.txt"));
    expect(r.findings).toEqual([]);
    expect(r.notes[0]).toContain("not a recognised artifact");
  });

  it("stops at maxFiles and says so", () => {
    const root = tmp();
    write(root, Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`f${i}.js`, minified])));
    const r = scanPath(root, { maxFiles: 3 });
    expect(r.truncated).toBe(true);
    expect(r.scannedFiles).toBe(3);
    expect(r.notes.join("\n")).toContain("Stopped after 3 files");
  });

  it("honours include and exclude filters", () => {
    const root = tmp();
    write(root, { "public/app.js": 'fetch("http://localhost:1")', "vendor/x.js": 'fetch("http://localhost:2")' });
    expect(scanPath(root, { exclude: ["vendor"] }).findings[0].match).toBe("http://localhost:1");
    expect(scanPath(root, { include: ["vendor"] }).findings[0].match).toBe("http://localhost:2");
  });

  it("throws for a path that does not exist", () => {
    expect(() => scanPath(join(tmp(), "missing"))).toThrow(/Path not found/);
  });
});

describe("grade", () => {
  it("grades by the worst finding", () => {
    expect(grade([])).toBe("A");
    expect(grade([finding("native_no_relro", "x")])).toBe("B");
    expect(grade([finding("native_no_pie", "x")])).toBe("C");
    expect(grade([finding("sourcemap_shipped", "x")])).toBe("D");
    expect(grade([finding("sourcemap_shipped", "a"), finding("apk_unsigned", "b"), finding("native_debug_info", "c")])).toBe("F");
    expect(grade([finding("apk_debuggable", "x")])).toBe("F");
  });
});

describe("rule catalog", () => {
  it("has unique ids and a fix for every check", () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
    for (const r of RULES) {
      expect(r.recommendation.length).toBeGreaterThan(20);
      expect(r.exposes.length).toBeGreaterThan(20);
    }
  });
});

describe("scanPath with a trailing slash", () => {
  it("still treats Foo.app/ as one bundle instead of walking its frameworks", () => {
    const root = tmp();
    const app = join(root, "Native.app");
    write(app, {
      "Contents/MacOS/Native": buildMachO64({ signature: { flags: 0x10000 } }),
      "Contents/Frameworks/Third.framework/Third": buildMachO64({ symbols: Array(5).fill(0x0f), signature: null }),
    });
    expect(scanPath(`${app}/`).findings).toEqual([]);
    expect(ids(scanPath(join(app, "Contents")).findings)).toEqual(["native_unsigned"]);
  });
});
