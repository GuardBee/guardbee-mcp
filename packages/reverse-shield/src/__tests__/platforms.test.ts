import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeApk } from "../apk.js";
import { ATTR } from "../axml.js";
import { analyzeJar, frameworkChecks, pyinstallerCheck } from "../frameworks.js";
import { analyzeIpa } from "../ios.js";
import { parsePlist, plistInside } from "../plist.js";
import { parseProtoXml } from "../protoxml.js";
import { scanPath } from "../scanner.js";
import type { ArtifactFile } from "../web.js";
import {
  READABLE_DOTNET_NAMES,
  buildBinaryPlist,
  buildDex,
  buildMachO64,
  buildPe,
  buildProtoManifest,
  buildZip,
  entitlementsPlist,
  il2cppMetadata,
  pyinstallerExe,
} from "./testFixtures.js";

const ids = (fs: { patternId: string }[]) => fs.map((f) => f.patternId).sort();
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function write(files: Record<string, Buffer | string>): string {
  const root = mkdtempSync(join(tmpdir(), "rs-platforms-"));
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

const PKG = "com.example.shop";
const appClasses = (n: number) => Array.from({ length: n }, (_, i) => `Lcom/example/shop/checkout/PaymentScreen${i}ViewModel;`);

describe("App Bundle (.aab)", () => {
  const manifest = (debuggable: boolean) =>
    buildProtoManifest({
      name: "manifest",
      attrs: [{ name: "package", value: PKG }],
      children: [
        { name: "uses-sdk", attrs: [{ name: "minSdkVersion", value: "26", resourceId: 0x0101020c }] },
        { name: "application", attrs: [{ name: "allowBackup", value: "false", resourceId: ATTR.allowBackup }, { name: "debuggable", value: String(debuggable), resourceId: ATTR.debuggable }] },
      ],
    });

  it("parses the protobuf manifest into elements and typed attributes", () => {
    const els = parseProtoXml(manifest(true))!;
    expect(els.map((e) => e.name)).toEqual(["manifest", "uses-sdk", "application"]);
    expect(els[2].attributes).toEqual([
      { name: "allowBackup", resourceId: ATTR.allowBackup, value: false },
      { name: "debuggable", resourceId: ATTR.debuggable, value: true },
    ]);
    expect(parseProtoXml(Buffer.from("not protobuf at all"))).toBeNull();
  });

  it("checks base/ and feature-module dex, and does not judge signing", () => {
    const dir = write({
      "app.aab": buildZip([
        { name: "base/manifest/AndroidManifest.xml", data: manifest(true) },
        { name: "base/dex/classes.dex", data: buildDex(appClasses(40)) },
        { name: "feature_pay/dex/classes.dex", data: buildDex(appClasses(5)) },
        { name: "BundleConfig.pb", data: Buffer.alloc(4) },
      ]),
    });
    const r = analyzeApk(join(dir, "app.aab"))!;
    expect(ids(r.findings)).toEqual(["apk_debuggable", "apk_no_obfuscation"]);
    expect(r.notes.join("\n")).toContain("2 dex file(s)");
    expect(r.notes.join("\n")).toContain("signing is not judged");
  });

  it("is picked up by scanPath", () => {
    const dir = write({ "release.aab": buildZip([{ name: "base/manifest/AndroidManifest.xml", data: manifest(false) }]) });
    const r = scanPath(join(dir, "release.aab"));
    expect(r.kinds).toEqual(["android"]);
    expect(r.findings).toEqual([]);
  });
});

describe("plist", () => {
  it("reads binary and XML plists alike", () => {
    const values = { CFBundleExecutable: "Shop", CFBundleIdentifier: "com.example.shop", UIRequiresFullScreen: true, LSRequiresIPhoneOS: false };
    expect(parsePlist(buildBinaryPlist(values))).toEqual(values);
    const xml = `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Shop &amp; Co</string><key>Flags</key><array><true/><integer>3</integer></array></dict></plist>`;
    expect(parsePlist(Buffer.from(xml))).toEqual({ CFBundleExecutable: "Shop & Co", Flags: [true, 3] });
  });

  it("finds the XML plist inside a signed blob", () => {
    const blob = Buffer.concat([Buffer.from([0x30, 0x82, 0x01, 0x00]), Buffer.from(`<?xml version="1.0"?><plist><dict><key>Name</key><string>Dev</string></dict></plist>`), Buffer.alloc(16)]);
    expect(plistInside(blob)).toEqual({ Name: "Dev" });
  });
});

describe("iOS (.ipa and .app)", () => {
  const info = buildBinaryPlist({ CFBundleExecutable: "Shop", CFBundleIdentifier: "com.example.shop", DTPlatformName: "iphoneos" });
  const signedExe = buildMachO64({ signature: { flags: 0 } });

  it("flags a Debug build, a development profile and a plain React Native bundle", () => {
    const profile = Buffer.from(`xx<?xml version="1.0"?><plist><dict><key>Name</key><string>iOS Team Provisioning Profile</string><key>Entitlements</key><dict><key>get-task-allow</key><true/></dict></dict></plist>yy`);
    const dir = write({
      "Shop.ipa": buildZip([
        { name: "Payload/Shop.app/Info.plist", data: info },
        { name: "Payload/Shop.app/Shop", data: signedExe },
        { name: "Payload/Shop.app/Shop.debug.dylib", data: buildMachO64({ filetype: 6, symbols: [0x66, 0x66, ...Array(20).fill(0x0e)], signature: { flags: 0 } }) },
        { name: "Payload/Shop.app/__preview.dylib", data: Buffer.alloc(64) },
        { name: "Payload/Shop.app/embedded.mobileprovision", data: profile },
        { name: "Payload/Shop.app/main.jsbundle", data: Buffer.from('var __DEV__=false;fetch("http://192.168.1.4:8081")') },
      ]),
    });
    const r = analyzeIpa(join(dir, "Shop.ipa"))!;
    expect(ids(r.findings)).toEqual(["internal_endpoint", "ios_debug_build", "ios_development_profile", "ios_js_bundle_plaintext", "native_debug_info", "native_symbols_not_stripped"]);
    expect(r.notes).toContain("bundle com.example.shop (iphoneos)");
  });

  it("passes a Release build signed for distribution, and never asks iOS for the macOS hardened runtime", () => {
    const profile = Buffer.from(`<?xml version="1.0"?><plist><dict><key>Name</key><string>Shop AppStore</string><key>Entitlements</key><dict><key>get-task-allow</key><false/></dict></dict></plist>`);
    const hermes = Buffer.concat([Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]), Buffer.alloc(32)]);
    const dir = write({
      "Shop.ipa": buildZip([
        { name: "Payload/Shop.app/Info.plist", data: info },
        { name: "Payload/Shop.app/Shop", data: signedExe },
        { name: "Payload/Shop.app/embedded.mobileprovision", data: profile },
        { name: "Payload/Shop.app/main.jsbundle", data: hermes },
      ]),
    });
    const r = analyzeIpa(join(dir, "Shop.ipa"))!;
    expect(r.findings).toEqual([]);
    expect(r.notes).toEqual(expect.arrayContaining(["provisioning profile Shop AppStore", "React Native bundle is Hermes bytecode"]));
  });

  it("scans an iOS .app folder and a Capacitor web bundle inside it", () => {
    const dir = write({
      "Shop.app/Info.plist": info,
      "Shop.app/Shop": buildMachO64({ signature: { flags: 0, entitlements: entitlementsPlist(["get-task-allow"]) } }),
      "Shop.app/public/assets/index-AB12CD34.js": "x()\n//# sourceMappingURL=index-AB12CD34.js.map",
      "Shop.app/public/assets/index-AB12CD34.js.map": JSON.stringify({ version: 3, mappings: "AAAA", sources: ["src/App.tsx"], sourcesContent: ["x"] }),
    });
    const r = scanPath(join(dir, "Shop.app"));
    expect(r.kinds.sort()).toEqual(["ios", "web"]);
    expect(ids(r.findings)).toEqual(["sourcemap_embeds_source"]);
  });

  it("returns null for a zip without Payload", () => {
    const dir = write({ "x.ipa": buildZip([{ name: "readme.txt", data: Buffer.from("hi") }]) });
    expect(analyzeIpa(join(dir, "x.ipa"))).toBeNull();
  });
});

describe("Unity", () => {
  it("flags clear IL2CPP metadata wherever the player keeps it", () => {
    for (const key of ["assets/bin/Data/Managed/Metadata/global-metadata.dat", "Data/Managed/Metadata/global-metadata.dat", "Game_Data/il2cpp_data/Metadata/global-metadata.dat"]) {
      const r = frameworkChecks(mem({ [key]: il2cppMetadata(31) }));
      expect(ids(r.findings)).toEqual(["unity_il2cpp_metadata"]);
      expect(r.findings[0].match).toContain("v31");
    }
  });

  it("notes protected metadata instead of flagging it", () => {
    const r = frameworkChecks(mem({ "Data/Managed/Metadata/global-metadata.dat": Buffer.alloc(64, 0x5a) }));
    expect(r.findings).toEqual([]);
    expect(r.notes.join("\n")).toContain("encrypted or protected");
  });

  it("judges Mono Assembly-CSharp.dll with the .NET name check", () => {
    const plain = frameworkChecks(mem({ "Game_Data/Managed/Assembly-CSharp.dll": buildPe({ dll: true, dotnetNames: READABLE_DOTNET_NAMES }) }));
    expect(ids(plain.findings)).toEqual(["unity_mono_assemblies"]);
    const renamed = [...READABLE_DOTNET_NAMES.slice(10), "a", "b", "A", "B", "c", "1", "2", "3"];
    expect(frameworkChecks(mem({ "Game_Data/Managed/Assembly-CSharp.dll": buildPe({ dll: true, dotnetNames: renamed }) })).findings).toEqual([]);
  });

  it("reports the Unity finding, not also the generic .NET one, for a desktop build folder", () => {
    const dir = write({
      "Game_Data/Managed/Assembly-CSharp.dll": buildPe({ dll: true, dotnetNames: READABLE_DOTNET_NAMES }),
      "Game_Data/il2cpp_data/Metadata/global-metadata.dat": il2cppMetadata(),
    });
    const r = scanPath(dir);
    expect(ids(r.findings)).toEqual(["unity_il2cpp_metadata", "unity_mono_assemblies"]);
    expect(r.notes).toContain("Unity player detected");
  });
});

describe("Flutter", () => {
  it("recognises the engine and app snapshot and leaves a note", () => {
    const r = frameworkChecks(mem({ "lib/arm64-v8a/libflutter.so": Buffer.alloc(8), "lib/arm64-v8a/libapp.so": Buffer.alloc(8) }));
    expect(r.findings).toEqual([]);
    expect(r.notes[0]).toContain("--obfuscate --split-debug-info");
    expect(frameworkChecks(mem({ "lib/arm64-v8a/libapp.so": Buffer.alloc(8) })).notes).toEqual([]);
  });
});

describe("PyInstaller", () => {
  it("flags the archive, and accepts PyArmor and Nuitka builds", () => {
    expect(ids(pyinstallerCheck(pyinstallerExe(), "shop").findings)).toEqual(["python_pyinstaller_bundle"]);
    expect(pyinstallerCheck(pyinstallerExe(), "shop").findings[0].match).toBe("PyInstaller archive (python3.12)");
    expect(pyinstallerCheck(pyinstallerExe("pyarmor_runtime_000000"), "shop")).toEqual({ findings: [], notes: ["shop: PyInstaller bundle protected with PyArmor"] });
    expect(pyinstallerCheck(Buffer.from("...Nuitka...__compiled__..."), "shop").notes).toEqual(["shop: compiled with Nuitka (Python compiled to C)"]);
    expect(pyinstallerCheck(Buffer.from("plain binary"), "x")).toEqual({ findings: [], notes: [] });
  });

  it("is checked for native executables found by scanPath", () => {
    const dir = write({ "dist/shop": pyinstallerExe() });
    expect(ids(scanPath(dir).findings)).toEqual(["python_pyinstaller_bundle"]);
  });
});

describe("Java", () => {
  const classes = (pkg: string, names: string[]) => names.map((n) => ({ name: `${pkg}/${n}.class`, data: Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 61]) }));
  const readable = Array.from({ length: 30 }, (_, i) => `PaymentScreen${i}Controller`);

  it("flags readable classes under the Main-Class package", () => {
    const dir = write({ "shop.jar": buildZip([{ name: "META-INF/MANIFEST.MF", data: Buffer.from("Manifest-Version: 1.0\r\nMain-Class: com.example.shop.Main\r\n") }, ...classes("com/example/shop", ["Main", ...readable])]) });
    const r = analyzeJar(join(dir, "shop.jar"));
    expect(ids(r.findings)).toEqual(["java_not_obfuscated"]);
    expect(r.findings[0].match).toContain("31 classes under com.example.shop, 0 renamed");
  });

  it("follows Spring Boot's Start-Class into BOOT-INF/classes, and folded manifest lines", () => {
    const mf = "Manifest-Version: 1.0\r\nMain-Class: org.springframework.boot.loader.launch.JarLauncher\r\nStart-Class: com.example.shop.ShopApplicati\r\n on\r\n";
    const dir = write({ "app.jar": buildZip([{ name: "META-INF/MANIFEST.MF", data: Buffer.from(mf) }, ...classes("BOOT-INF/classes/com/example/shop", ["ShopApplication", ...readable])]) });
    expect(ids(analyzeJar(join(dir, "app.jar")).findings)).toEqual(["java_not_obfuscated"]);
  });

  it("accepts a ProGuard-style jar and explains when there is no entry point", () => {
    const short = Array.from({ length: 30 }, (_, i) => String.fromCharCode(97 + (i % 26)) + (i >= 26 ? "a" : ""));
    const dir = write({
      "obf.jar": buildZip([{ name: "META-INF/MANIFEST.MF", data: Buffer.from("Main-Class: com.example.shop.Main\n") }, ...classes("com/example/shop", ["Main", ...short])]),
      "lib.jar": buildZip(classes("com/example/lib", readable)),
    });
    expect(analyzeJar(join(dir, "obf.jar")).findings).toEqual([]);
    expect(analyzeJar(join(dir, "lib.jar")).notes[0]).toContain("no Main-Class/Start-Class");
  });
});
