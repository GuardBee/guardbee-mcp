import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeApk } from "../apk.js";
import { ATTR } from "../axml.js";
import { assessDartNames, frameworkChecks } from "../frameworks.js";
import { analyzeIpa } from "../ios.js";
import { scanPath } from "../scanner.js";
import { analyzeWasm, wasmCustomSections } from "../wasm.js";
import type { ArtifactFile } from "../web.js";
import { apkSigningBlock, buildAxml, buildBinaryPlist, buildMachO64, buildZip } from "./testFixtures.js";

const ids = (fs: { patternId: string }[]) => fs.map((f) => f.patternId).sort();
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function write(files: Record<string, Buffer | string>): string {
  const root = mkdtempSync(join(tmpdir(), "rs-depth-"));
  dirs.push(root);
  for (const [p, data] of Object.entries(files)) {
    const full = join(root, ...p.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
  }
  return root;
}
const mem = (files: Record<string, Buffer>): ArtifactFile[] =>
  Object.entries(files).map(([key, data]) => ({ key, display: key, size: data.length, read: () => data }));

// ── WebAssembly ─────────────────────────────────────────────────────────────

const leb = (n: number): Buffer => {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Buffer.from(out);
};
const vecName = (s: string) => Buffer.concat([leb(Buffer.byteLength(s)), Buffer.from(s)]);
const section = (id: number, body: Buffer) => Buffer.concat([Buffer.from([id]), leb(body.length), body]);
const custom = (name: string, body: Buffer) => section(0, Buffer.concat([vecName(name), body]));
const nameSection = (fns: string[]) => {
  const map = Buffer.concat([leb(fns.length), ...fns.map((f, i) => Buffer.concat([leb(i), vecName(f)]))]);
  return custom("name", Buffer.concat([Buffer.from([1]), leb(map.length), map]));
};
const wasm = (...sections: Buffer[]) => Buffer.concat([Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0, 0, 0]), section(1, Buffer.from([0])), ...sections]);

describe("WebAssembly", () => {
  it("flags DWARF, the name section and a source map reference", () => {
    const mod = wasm(custom(".debug_info", Buffer.alloc(2048)), custom(".debug_line", Buffer.alloc(1024)), nameSection(["checkout::authorize_payment", "cart::add_item", "loyalty::bonus", "main"]), custom("sourceMappingURL", vecName("app.wasm.map")));
    const f = analyzeWasm(mod, "app.wasm");
    expect(ids(f)).toEqual(["sourcemap_reference", "wasm_debug_info", "wasm_name_section"]);
    expect(f.find((x) => x.patternId === "wasm_debug_info")!.match).toBe(".debug_info, .debug_line (3 KiB)");
    expect(f.find((x) => x.patternId === "wasm_name_section")!.match).toBe("4 function names, e.g. checkout::authorize_payment, cart::add_item, loyalty::bonus");
    expect(f.find((x) => x.patternId === "sourcemap_reference")!.match).toBe("app.wasm.map");
  });

  it("passes a stripped module and survives a truncated one", () => {
    expect(analyzeWasm(wasm(custom("producers", Buffer.alloc(10))), "a.wasm")).toEqual([]);
    const cut = wasm(nameSection(["a", "b"])).subarray(0, 14);
    expect(() => wasmCustomSections(cut)).not.toThrow();
    expect(analyzeWasm(Buffer.from("not wasm at all"), "b.wasm")).toEqual([]);
  });

  it("is checked in build folders, next to the JavaScript", () => {
    const dir = write({ "dist/assets/app-AB12.wasm": wasm(nameSection(["shop::checkout"])), "dist/assets/app-AB12.js": "x()" });
    expect(ids(scanPath(join(dir, "dist")).findings)).toEqual(["wasm_name_section"]);
  });
});

// ── Flutter ─────────────────────────────────────────────────────────────────

// Dart VM names survive --obfuscate; the program's own names do not.
const VM_NAMES = Array.from({ length: 150 }, (_, i) => `_TypedListBase${i}`);
const readable = Array.from({ length: 200 }, (_, i) => `CheckoutPaymentController${i}`);
const renamed = Array.from({ length: 200 }, (_, i) => `_${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(97 + (i % 26))}@${1000000 + i}`);
const snapshot = (names: string[]) => Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(60), ...names.map((n) => Buffer.from(`${n}\0`))]);

describe("Flutter", () => {
  it("measures Dart obfuscation from the snapshot's names", () => {
    expect(assessDartNames(snapshot([...VM_NAMES, ...readable]))).toMatchObject({ obfuscated: false, short: 0 });
    expect(assessDartNames(snapshot([...VM_NAMES, ...renamed]))).toMatchObject({ obfuscated: true, short: 200 });
    expect(assessDartNames(snapshot(VM_NAMES.slice(0, 50)))).toBeNull();
  });

  it("flags an unobfuscated Android build and notes an obfuscated iOS one", () => {
    const manifest = buildAxml([
      { name: "manifest", attrs: [{ name: "package", string: "com.example.shop" }] },
      { name: "application", attrs: [{ name: "allowBackup", resourceId: ATTR.allowBackup, bool: false }] },
    ]);
    const dir = write({
      "app.apk": buildZip(
        [
          { name: "AndroidManifest.xml", data: manifest },
          { name: "lib/arm64-v8a/libflutter.so", data: Buffer.alloc(64) },
          { name: "lib/arm64-v8a/libapp.so", data: snapshot([...VM_NAMES, ...readable]) },
        ],
        apkSigningBlock(),
      ),
    });
    const apk = analyzeApk(join(dir, "app.apk"))!;
    const f = apk.findings.find((x) => x.patternId === "flutter_not_obfuscated")!;
    expect(f.match).toBe("350 Dart identifiers, 0% with 1–3 letter names");
    expect(f.file).toContain("!/lib/arm64-v8a/libapp.so");

    const ios = frameworkChecks(mem({ "Frameworks/Flutter.framework/Flutter": Buffer.alloc(8), "Frameworks/App.framework/App": snapshot([...VM_NAMES, ...renamed]) }));
    expect(ios.findings).toEqual([]);
    expect(ios.notes[0]).toMatch(/Dart code is obfuscated \(350 Dart identifiers, 57% with 1–3 letter names\)/);
  });

  it("says when the snapshot has too few names to judge", () => {
    const r = frameworkChecks(mem({ "lib/x86_64/libflutter.so": Buffer.alloc(8), "lib/x86_64/libapp.so": snapshot(["main"]) }));
    expect(r.findings).toEqual([]);
    expect(r.notes[0]).toContain("too few Dart names");
  });
});

// ── iOS .dSYM ───────────────────────────────────────────────────────────────

describe("iOS debug symbols", () => {
  it("flags .dSYM bundles copied into the app, once for all of them", () => {
    const info = buildBinaryPlist({ CFBundleExecutable: "Shop", CFBundleIdentifier: "com.example.shop" });
    const dir = write({
      "Shop.ipa": buildZip([
        { name: "Payload/Shop.app/Info.plist", data: info },
        { name: "Payload/Shop.app/Shop", data: buildMachO64({ signature: { flags: 0 } }) },
        { name: "Payload/Shop.app/Shop.app.dSYM/Contents/Resources/DWARF/Shop", data: Buffer.alloc(32) },
        { name: "Payload/Shop.app/Frameworks/Pay.framework/Pay.framework.dSYM/Contents/Info.plist", data: Buffer.from("<plist/>") },
      ]),
    });
    const f = analyzeIpa(join(dir, "Shop.ipa"))!.findings.filter((x) => x.patternId === "ios_dsym_shipped");
    expect(f).toHaveLength(1);
    expect(f[0].match).toBe("Shop.app.dSYM, Pay.framework.dSYM");
    expect(f[0].file!.endsWith("Payload/Shop.app/Shop.app.dSYM")).toBe(true);
  });
});
