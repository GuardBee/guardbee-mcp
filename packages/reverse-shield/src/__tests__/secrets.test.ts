import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeApk } from "../apk.js";
import { ATTR } from "../axml.js";
import { readDexStrings } from "../dex.js";
import { analyzeJar } from "../frameworks.js";
import { analyzeIpa } from "../ios.js";
import { scanPath } from "../scanner.js";
import { analyzeConfigFiles, binarySecrets, printableStrings, readArscStrings, readProtoStrings } from "../secrets.js";
import { apkSigningBlock, buildAsar, buildAxml, buildBinaryPlist, buildDex, buildElf64, buildFuseBinary, buildMachO64, buildZip } from "./testFixtures.js";

const AWS = "AKIAQ7XKZP3LMNB2RTUV";
const GOOGLE = "AIzaSyD4k9Qx7Lm2Np8Rt3Vw6Yz1Bc5Fg0HjKeX";
// Built from parts so the repo's own secret scan does not flag the fixtures.
const STRIPE = "sk_" + "live_4eC39HqLyjWDarjtT1zdp7dc";
const POSTGRES = "postgres://shop:" + "Xk29fLq8wZ@db.prod.shop-internal.net:5432/shop";

const secrets = (fs: { patternId: string; match: string }[]) => fs.filter((f) => f.patternId === "bundle_secret").map((f) => f.match.split(":")[0]).sort();
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function write(files: Record<string, Buffer | string>): string {
  const root = mkdtempSync(join(tmpdir(), "rs-secrets-"));
  dirs.push(root);
  for (const [p, data] of Object.entries(files)) {
    const full = join(root, ...p.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
  }
  return root;
}

/** resources.arsc: table header and a global string pool (no packages; only the pool is read). */
function buildArsc(strings: string[], utf8 = true): Buffer {
  const data: Buffer[] = [];
  const offsets = Buffer.alloc(strings.length * 4);
  let off = 0;
  strings.forEach((s, i) => {
    offsets.writeUInt32LE(off, i * 4);
    let entry: Buffer;
    if (utf8) {
      const bytes = Buffer.from(s, "utf8");
      const len = (n: number) => (n < 0x80 ? Buffer.from([n]) : Buffer.from([0x80 | (n >> 8), n & 0xff]));
      entry = Buffer.concat([len(s.length), len(bytes.length), bytes, Buffer.from([0])]);
    } else {
      const lenBuf = Buffer.alloc(2);
      lenBuf.writeUInt16LE(s.length);
      entry = Buffer.concat([lenBuf, Buffer.from(s, "utf16le"), Buffer.alloc(2)]);
    }
    data.push(entry);
    off += entry.length;
  });
  const body = Buffer.concat(data);
  const pool = Buffer.alloc(28);
  pool.writeUInt16LE(0x0001, 0);
  pool.writeUInt16LE(28, 2);
  pool.writeUInt32LE(28 + offsets.length + body.length, 4);
  pool.writeUInt32LE(strings.length, 8);
  pool.writeUInt32LE(utf8 ? 0x100 : 0, 16);
  pool.writeUInt32LE(28 + offsets.length, 20);
  const table = Buffer.alloc(12);
  table.writeUInt16LE(0x0002, 0);
  table.writeUInt16LE(12, 2);
  table.writeUInt32LE(12 + 28 + offsets.length + body.length, 4);
  return Buffer.concat([table, pool, offsets, body]);
}

function protoString(no: number, value: Buffer | string): Buffer {
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  return Buffer.concat([Buffer.from([(no << 3) | 2, bytes.length]), bytes]);
}

const manifest = buildAxml([
  { name: "manifest", attrs: [{ name: "package", string: "com.example.shop" }] },
  { name: "application", attrs: [{ name: "allowBackup", resourceId: ATTR.allowBackup, bool: false }] },
]);
const apk = (entries: Array<{ name: string; data: Buffer }>) => buildZip([{ name: "AndroidManifest.xml", data: manifest }, ...entries], apkSigningBlock());

describe("string extraction", () => {
  it("pulls ASCII and UTF-16LE runs out of a binary, skipping short ones", () => {
    const buf = Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(`short\0${AWS}\0`), Buffer.from([0xff, 0xff]), Buffer.from(`id=${GOOGLE}`, "utf16le"), Buffer.from([0xff, 0xfe])]);
    const text = printableStrings(buf);
    expect(text.split("\n")).toEqual([AWS, `id=${GOOGLE}`]);
  });

  it("reads the resources.arsc pool through its offsets, in UTF-8 and UTF-16", () => {
    // 'A' (0x41) as a length byte would glue onto the value if the pool were read as raw runs.
    const long = `${"x".repeat(150)}${STRIPE}`;
    expect(readArscStrings(buildArsc(["app_name", "A".repeat(65), long]))).toEqual(["app_name", "A".repeat(65), long]);
    expect(readArscStrings(buildArsc(["Shop", GOOGLE], false))).toEqual(["Shop", GOOGLE]);
    expect(readArscStrings(Buffer.from("not a table"))).toEqual([]);
  });

  it("reads string fields of a protobuf resource table without its schema", () => {
    const pb = Buffer.concat([protoString(1, "com.example.shop"), protoString(2, Buffer.concat([protoString(1, "google_api_key"), protoString(3, GOOGLE)]))]);
    expect(readProtoStrings(pb)).toEqual(["com.example.shop", "google_api_key", GOOGLE]);
  });

  it("reads dex string constants of at least 16 characters", () => {
    expect(readDexStrings(buildDex(["Lcom/a/B;", `https://api.shop.com/v1?key=${AWS}`]))).toEqual([`https://api.shop.com/v1?key=${AWS}`]);
  });
});

describe("credentials in Android packages", () => {
  it("finds keys in dex, resources, assets, res/raw, Hermes bytecode and native libraries", () => {
    const hermes = Buffer.concat([Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]), Buffer.alloc(16), Buffer.from(`\0${POSTGRES}\0`)]);
    const dir = write({
      "app.apk": apk([
        { name: "classes.dex", data: buildDex(["Lcom/example/shop/a;", AWS]) },
        { name: "resources.arsc", data: buildArsc(["Shop", GOOGLE]) },
        { name: "assets/config.json", data: Buffer.from(JSON.stringify({ stripe: STRIPE })) },
        { name: "res/raw/keys", data: Buffer.from(`token=${STRIPE}`) },
        { name: "assets/index.android.bundle", data: hermes },
        { name: "lib/arm64-v8a/libkeys.so", data: Buffer.concat([buildElf64({ type: "shared", sections: [] }), Buffer.from(`\0${AWS}\0`)]) },
      ]),
    });
    const r = analyzeApk(join(dir, "app.apk"))!;
    const bySource = Object.fromEntries(r.findings.filter((f) => f.patternId === "bundle_secret").map((f) => [`${f.file!.split("!/")[1]} ${f.match.split(":")[0]}`, f]));
    expect(Object.keys(bySource).sort()).toEqual([
      "assets/config.json Stripe Secret Key (live)",
      "assets/index.android.bundle PostgreSQL Connection String with credentials",
      "classes.dex AWS Access Key ID",
      "lib/arm64-v8a/libkeys.so AWS Access Key ID",
      "res/raw/keys Stripe Secret Key (live)",
      "resources.arsc Google API Key",
    ]);
    expect(bySource["classes.dex AWS Access Key ID"]).toMatchObject({ target: "android", severity: "critical", line: 1 });
    expect(bySource["assets/config.json Stripe Secret Key (live)"].column).toBeGreaterThan(1);
    // The google-services plugin ships the Firebase key in every Firebase app: it must be restricted, not removed.
    expect(bySource["resources.arsc Google API Key"]).toMatchObject({ severity: "medium" });
    expect(bySource["resources.arsc Google API Key"].context).toContain("restricted to this app's package name");
  });

  it("reports one key found in several files of the package once, with how far it spreads", () => {
    const dir = write({
      "app.apk": apk([
        { name: "classes.dex", data: buildDex(["Lcom/example/shop/a;", AWS]) },
        { name: "classes2.dex", data: buildDex(["Lcom/example/shop/b;", AWS]) },
        { name: "lib/arm64-v8a/libkeys.so", data: Buffer.concat([buildElf64({ type: "shared", sections: [] }), Buffer.from(`\0${AWS}\0`)]) },
      ]),
    });
    const keys = scanPath(join(dir, "app.apk")).findings.filter((f) => f.patternId === "bundle_secret");
    expect(keys).toHaveLength(1);
    expect(keys[0].match).toMatch(/AWS Access Key ID: AKIA…UV \(20 chars\) — also in 2 other file\(s\)/);
  });

  it("reads the App Bundle's protobuf resource table", () => {
    const proto = buildZip([
      { name: "base/manifest/AndroidManifest.xml", data: Buffer.alloc(0) },
      { name: "base/resources.pb", data: protoString(1, Buffer.concat([protoString(1, "google_api_key"), protoString(3, GOOGLE)])) },
    ]);
    const dir = write({ "app.aab": proto });
    expect(secrets(analyzeApk(join(dir, "app.aab"))!.findings)).toEqual(["Google API Key"]);
  });

  it("ignores placeholder keys and short strings", () => {
    const dir = write({
      "app.apk": apk([
        { name: "classes.dex", data: buildDex(["Lcom/example/shop/a;", "AKIAIOSFODNN7EXAMPLE"]) },
        { name: "assets/settings.json", data: Buffer.from(`{"stripe":"${"sk_" + "live_" + "x".repeat(24)}"}`) },
      ]),
    });
    expect(secrets(analyzeApk(join(dir, "app.apk"))!.findings)).toEqual([]);
  });
});

describe("credentials in iOS, desktop and server artifacts", () => {
  it("finds the Firebase key in GoogleService-Info.plist and a key compiled into the executable", () => {
    const dir = write({
      "Shop.ipa": buildZip([
        { name: "Payload/Shop.app/Info.plist", data: buildBinaryPlist({ CFBundleExecutable: "Shop", CFBundleIdentifier: "com.example.shop" }) },
        { name: "Payload/Shop.app/GoogleService-Info.plist", data: buildBinaryPlist({ API_KEY: GOOGLE, BUNDLE_ID: "com.example.shop" }) },
        { name: "Payload/Shop.app/Shop", data: Buffer.concat([buildMachO64({ signature: { flags: 0 } }), Buffer.from(`\0Bearer ${STRIPE}\0`)]) },
      ]),
    });
    const keys = analyzeIpa(join(dir, "Shop.ipa"))!.findings.filter((f) => f.patternId === "bundle_secret");
    expect(keys.map((k) => [k.file!.split("/").pop(), k.match.split(":")[0], k.severity, k.target]).sort()).toEqual([
      ["GoogleService-Info.plist", "Google API Key", "medium", "ios"],
      ["Shop", "Stripe Secret Key (live)", "critical", "ios"],
    ]);
  });

  it("checks config files inside an Electron app's ASAR", () => {
    const dir = write({
      "Shop.app/Contents/Frameworks/Electron Framework.framework/Electron Framework": buildFuseBinary("1010"),
      "Shop.app/Contents/Resources/app.asar": buildAsar({ "package.json": '{"main":"main.js"}', "main.js": "require('./x')", ".env.production": `DATABASE_URL=${POSTGRES}\n` }),
    });
    const r = scanPath(join(dir, "Shop.app"));
    const key = r.findings.find((f) => f.patternId === "bundle_secret")!;
    expect(key).toMatchObject({ target: "electron", line: 1 });
    expect(key.match).toContain("PostgreSQL Connection String with credentials");
  });

  it("checks application.properties in a Spring Boot JAR", () => {
    const dir = write({
      "app.jar": buildZip([
        { name: "META-INF/MANIFEST.MF", data: Buffer.from("Main-Class: com.example.shop.Main\n") },
        { name: "BOOT-INF/classes/application.properties", data: Buffer.from(`server.port=8080\nspring.datasource.url=${POSTGRES}\n`) },
      ]),
    });
    const key = analyzeJar(join(dir, "app.jar")).findings.find((f) => f.patternId === "bundle_secret")!;
    expect(key).toMatchObject({ target: "framework", line: 2 });
  });

  it("checks native binaries and config files in a build folder", () => {
    const dir = write({
      "out/server": Buffer.concat([buildElf64({ type: "pie", sections: [] }), Buffer.from(`\0${AWS}\0`)]),
      "out/config.json": JSON.stringify({ apiKey: STRIPE }),
    });
    const r = scanPath(join(dir, "out"));
    expect(r.findings.filter((f) => f.patternId === "bundle_secret").map((f) => [f.file!.split("/").pop(), f.target]).sort()).toEqual([
      ["config.json", "web"],
      ["server", "native"],
    ]);
  });

  it("judges binary plists by value and other binary formats by their strings", () => {
    const files = [
      { key: "a.plist", display: "a.plist", size: 0, read: () => buildBinaryPlist({ token: STRIPE }) },
      { key: "b.xml", display: "b.xml", size: 0, read: () => Buffer.concat([Buffer.from([3, 0, 8, 0]), Buffer.from(STRIPE, "utf16le")]) },
    ];
    expect(analyzeConfigFiles(files).map((f) => f.file)).toEqual(["a.plist", "b.xml"]);
    expect(binarySecrets(Buffer.from("nothing to see here, move along"), "x")).toEqual([]);
  });
});
