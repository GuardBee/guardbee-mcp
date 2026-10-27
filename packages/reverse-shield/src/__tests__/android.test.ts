import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeApk } from "../apk.js";
import { ATTR, attribute, parseAxml } from "../axml.js";
import { assessDexObfuscation, readTypeDescriptors } from "../dex.js";
import { apkSigningBlock, buildAxml, buildDex, buildElf64, buildZip } from "./testFixtures.js";

const ids = (fs: { patternId: string }[]) => fs.map((f) => f.patternId).sort();
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function writeApk(buf: Buffer): string {
  const d = mkdtempSync(join(tmpdir(), "rs-apk-"));
  dirs.push(d);
  const p = join(d, "app.apk");
  writeFileSync(p, buf);
  return p;
}

const PKG = "com.example.shop";
const appClasses = (n: number, short = false) =>
  Array.from({ length: n }, (_, i) => (short ? `L${PKG.replace(/\./g, "/")}/${String.fromCharCode(97 + (i % 26))};` : `L${PKG.replace(/\./g, "/")}/checkout/PaymentScreen${i}ViewModel;`));

function manifest(app: { debuggable?: boolean; allowBackup?: boolean; testOnly?: boolean }): Buffer {
  const attrs = [];
  if (app.debuggable !== undefined) attrs.push({ name: "debuggable", resourceId: ATTR.debuggable, bool: app.debuggable });
  if (app.allowBackup !== undefined) attrs.push({ name: "allowBackup", resourceId: ATTR.allowBackup, bool: app.allowBackup });
  if (app.testOnly !== undefined) attrs.push({ name: "testOnly", resourceId: ATTR.testOnly, bool: app.testOnly });
  return buildAxml([
    { name: "manifest", attrs: [{ name: "package", string: PKG }] },
    { name: "application", attrs },
    { name: "activity", attrs: [{ name: "name", resourceId: 0x01010003, string: `${PKG}.MainActivity` }] },
  ]);
}

describe("parseAxml", () => {
  it("reads element names, typed booleans and strings, keyed by resource id", () => {
    const elements = parseAxml(manifest({ debuggable: true, allowBackup: false }))!;
    expect(elements.map((e) => e.name)).toEqual(["manifest", "application", "activity"]);
    const app = elements[1];
    expect(attribute(app, "debuggable")?.value).toBe(true);
    expect(attribute(app, "allowBackup")?.value).toBe(false);
    expect(attribute(app, "testOnly")).toBeUndefined();
    expect(elements[0].attributes[0]).toMatchObject({ name: "package", value: PKG });
  });

  it("returns null for text XML", () => {
    expect(parseAxml(Buffer.from('<?xml version="1.0"?><manifest/>'))).toBeNull();
  });
});

describe("dex", () => {
  it("reads type descriptors", () => {
    expect(readTypeDescriptors(buildDex(["I", "Ljava/lang/Object;", "Lcom/example/A;"]))).toEqual(["I", "Ljava/lang/Object;", "Lcom/example/A;"]);
  });

  it("calls readable app classes unobfuscated and renamed ones obfuscated", () => {
    expect(assessDexObfuscation(appClasses(40), PKG)).toMatchObject({ appClasses: 40, shortNamed: 0, obfuscated: false });
    expect(assessDexObfuscation(appClasses(40, true), PKG).obfuscated).toBe(true);
  });

  it("does not judge an app whose classes R8 moved out of the package", () => {
    expect(assessDexObfuscation([...appClasses(3), ...Array.from({ length: 200 }, (_, i) => `La${i}/b;`)], PKG).obfuscated).toBe(true);
  });

  it("ignores generated R and BuildConfig classes", () => {
    const generated = ["R", "R$string", "R$id", "BuildConfig"].map((c) => `L${PKG.replace(/\./g, "/")}/${c};`);
    expect(assessDexObfuscation(generated, PKG).appClasses).toBe(0);
  });
});

describe("analyzeApk", () => {
  it("flags a debug build: debuggable, unobfuscated, backup allowed, v1-only signature", () => {
    const apk = writeApk(buildZip([
      { name: "AndroidManifest.xml", data: manifest({ debuggable: true }) },
      { name: "classes.dex", data: buildDex(appClasses(60)), deflate: true },
      { name: "META-INF/CERT.RSA", data: Buffer.from("sig") },
    ]));
    const result = analyzeApk(apk)!;
    expect(ids(result.findings)).toEqual(["apk_allow_backup", "apk_debuggable", "apk_no_obfuscation", "apk_v1_only_signature"]);
    expect(result.findings.find((f) => f.patternId === "apk_allow_backup")!.match).toContain("defaults to true");
    expect(result.findings.find((f) => f.patternId === "apk_no_obfuscation")!.match).toContain("PaymentScreen0ViewModel");
  });

  it("passes a hardened release build", () => {
    const apk = writeApk(buildZip(
      [
        { name: "AndroidManifest.xml", data: manifest({ allowBackup: false }) },
        { name: "classes.dex", data: buildDex([...appClasses(2), ...appClasses(60, true)]) },
        { name: "META-INF/CERT.RSA", data: Buffer.from("sig") },
      ],
      apkSigningBlock(),
    ));
    const result = analyzeApk(apk)!;
    expect(result.findings).toEqual([]);
    expect(result.notes.join("\n")).toContain("signed with APK Signature Scheme v2+ and v1");
  });

  it("reports an unsigned APK, testOnly, a plain React Native bundle and unstripped native libraries", () => {
    const apk = writeApk(buildZip([
      { name: "AndroidManifest.xml", data: manifest({ allowBackup: false, testOnly: true }) },
      { name: "assets/index.android.bundle", data: Buffer.from('var x=1;fetch("http://192.168.1.20:8081/status")') },
      { name: "lib/arm64-v8a/libcore.so", data: buildElf64({ type: "shared", sections: [{ name: ".symtab", type: 2, size: 240, entsize: 24 }] }) },
      { name: "lib/armeabi-v7a/libcore.so", data: buildElf64({ type: "shared", sections: [{ name: ".symtab", type: 2, size: 240, entsize: 24 }] }) },
    ]));
    const result = analyzeApk(apk)!;
    expect(ids(result.findings)).toEqual(["apk_js_bundle_plaintext", "apk_test_only", "apk_unsigned", "internal_endpoint", "native_symbols_not_stripped"]);
  });

  it("accepts a Hermes bytecode bundle", () => {
    const hermes = Buffer.concat([Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]), Buffer.alloc(64)]);
    const apk = writeApk(buildZip([
      { name: "AndroidManifest.xml", data: manifest({ allowBackup: false }) },
      { name: "assets/index.android.bundle", data: hermes },
    ], apkSigningBlock()));
    const result = analyzeApk(apk)!;
    expect(result.findings).toEqual([]);
    expect(result.notes).toContain("React Native bundle is Hermes bytecode");
  });

  it("returns null for a zip without a manifest", () => {
    expect(analyzeApk(writeApk(buildZip([{ name: "readme.txt", data: Buffer.from("hi") }])))).toBeNull();
  });
});
