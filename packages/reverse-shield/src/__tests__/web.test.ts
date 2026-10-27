import { describe, expect, it } from "vitest";
import { analyzeJavaScript, analyzeWebFiles, collapseRepeats, looksUnminified, parseSourceMap, sourceMappingUrl } from "../web.js";
import type { ArtifactFile } from "../web.js";

const ids = (fs: { patternId: string }[]) => fs.map((f) => f.patternId).sort();

function unminifiedSource(lines = 80): string {
  const out = ["export class LicenseValidator {"];
  for (let i = 0; i < lines; i++) out.push(`    validateLicenseKey${i}(key) {`, "        return key.startsWith('GB-');", "    }");
  out.push("}");
  return out.join("\n");
}

function minifiedSource(): string {
  return Array.from({ length: 300 }, (_, i) => `function a${i}(b){return b+${i}}`).join(";") + "\n";
}

const file = (key: string, text: string): ArtifactFile => ({ key, display: `dist/${key}`, size: Buffer.byteLength(text), read: () => Buffer.from(text) });

describe("parseSourceMap", () => {
  it("counts sources and embedded sourcesContent, preferring app paths for the sample", () => {
    const info = parseSourceMap(JSON.stringify({
      version: 3,
      mappings: "AAAA",
      sources: ["webpack://app/node_modules/react/index.js", "webpack://app/src/billing/LicenseValidator.ts"],
      sourcesContent: ["module.exports = 1", "export class LicenseValidator {}"],
    }));
    expect(info).toEqual({ sources: 2, embedded: 2, samplePaths: ["webpack://app/src/billing/LicenseValidator.ts"] });
  });

  it("rejects JSON that is not a source map", () => {
    expect(parseSourceMap('{"name":"pkg"}')).toBeNull();
    expect(parseSourceMap("not json")).toBeNull();
  });
});

describe("analyzeJavaScript", () => {
  it("flags an inline source map that embeds the original source as critical", () => {
    const map = Buffer.from(JSON.stringify({ version: 3, mappings: "AAAA", sources: ["src/app.ts"], sourcesContent: ["const secretSauce = 1"] })).toString("base64");
    const findings = analyzeJavaScript(`${minifiedSource()}//# sourceMappingURL=data:application/json;base64,${map}`, "app.js");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ patternId: "sourcemap_embeds_source", severity: "critical" });
    expect(findings[0].match).toContain("src/app.ts");
  });

  it("finds an inline map much longer than the file's tail", () => {
    const source = "x".repeat(200_000);
    const map = Buffer.from(JSON.stringify({ version: 3, mappings: "AAAA", sources: ["src/big.ts"], sourcesContent: [source] })).toString("base64");
    expect(ids(analyzeJavaScript(`${minifiedSource()}//# sourceMappingURL=data:application/json;base64,${map}\n`, "big.js"))).toEqual(["sourcemap_embeds_source"]);
  });

  it("uses the last mapping comment and ignores the key inside code or strings", () => {
    expect(sourceMappingUrl('var s="//# sourceMappingURL=fake.map";\n//# sourceMappingURL=real.js.map\n')).toBe("real.js.map");
    expect(sourceMappingUrl('x.sourceMappingURL=y;')).toBeNull();
    expect(sourceMappingUrl("//@ sourceMappingURL=old.map  \r\n")).toBe("old.map");
  });

  it("stays linear on adversarial input", () => {
    const hostile = "//#sourceMappingURL=".repeat(50_000) + "x y";
    const t = Date.now();
    expect(sourceMappingUrl(hostile)).toBeNull();
    expect(Date.now() - t).toBeLessThan(500);
  });

  it("flags an inline map without sources as sourcemap_inline", () => {
    const map = Buffer.from(JSON.stringify({ version: 3, mappings: "AAAA", sources: ["src/app.ts"] })).toString("base64");
    expect(ids(analyzeJavaScript(`x()\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${map}`, "app.js"))).toEqual(["sourcemap_inline"]);
  });

  it("reports an external sourceMappingURL as a low-severity reference", () => {
    const [f] = analyzeJavaScript(`${minifiedSource()}//# sourceMappingURL=app.js.map\n`, "app.js");
    expect(f).toMatchObject({ patternId: "sourcemap_reference", severity: "low", match: "//# sourceMappingURL=app.js.map" });
  });

  it("detects webpack eval-devtool bundles and does not also call them unminified", () => {
    const text = `${unminifiedSource()}\neval("const a = 1;\\n\\n//# sourceURL=webpack://app/./src/index.js?");`;
    expect(ids(analyzeJavaScript(text, "main.js"))).toEqual(["eval_devtool_bundle"]);
  });

  it("separates unminified from minified output", () => {
    expect(looksUnminified(unminifiedSource()).unminified).toBe(true);
    expect(looksUnminified(minifiedSource()).unminified).toBe(false);
    expect(ids(analyzeJavaScript(unminifiedSource(), "app.js"))).toEqual(["unminified_bundle"]);
    expect(analyzeJavaScript(minifiedSource(), "app.js")).toEqual([]);
  });

  it("skips the minification check for small files", () => {
    expect(analyzeJavaScript(unminifiedSource(5), "small.js")).toEqual([]);
  });

  it("detects framework development builds", () => {
    const [f] = analyzeJavaScript('var x=1;/** @license React\n * react-dom.development.js */', "vendor.js");
    expect(f).toMatchObject({ patternId: "dev_build_framework" });
    expect(f.match).toMatch(/^React:/);
  });

  it("finds fixed-format credentials and masks them", () => {
    const [f] = analyzeJavaScript('const s3={accessKeyId:"AKIAQ7XKZP3LMNB2RTUV"};', "app.js");
    expect(f).toMatchObject({ patternId: "bundle_secret", severity: "critical" });
    expect(f.match).not.toContain("AKIAQ7XKZP3LMNB2RTUV");
    expect(f.match).toContain("AKIA…");
  });

  it("ignores a PEM header that a crypto library keeps as a string constant", () => {
    const text = 'const H="-----BEGIN RSA PRIVATE KEY-----",F="-----END RSA PRIVATE KEY-----";function p(t){return t.indexOf(H)}';
    expect(analyzeJavaScript(text, "crypto.js")).toEqual([]);
  });

  it("flags a private key whose base64 body follows the header, also inside an escaped string", () => {
    const body = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKjMzEfYyjiWA4R4";
    expect(ids(analyzeJavaScript(`const k="-----BEGIN RSA PRIVATE KEY-----\\n${body}\\n-----END RSA PRIVATE KEY-----";`, "a.js"))).toEqual(["bundle_secret"]);
    expect(ids(analyzeJavaScript(`const k=\`-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\`;`, "b.js"))).toEqual(["bundle_secret"]);
  });

  it("skips connection-string placeholders shown in UI hints, in any language", () => {
    const text = 'const t={en:"postgresql://user:password@host:5432/mydb",tr:"postgresql://kullanici:sifre@host:5432/veritabani",m:"mongodb://admin:***@db.example.net/app"}';
    expect(analyzeJavaScript(text, "i18n.js")).toEqual([]);
  });

  it("still flags a connection string with a real-looking password and host", () => {
    // Assembled at runtime so the repository's own secretlint hook does not read it as a leak.
    const url = ["postgresql://shop", "Zx81kqL2vT@db-prod.shop-internal.net:5432/orders"].join(":");
    const [f] = analyzeJavaScript(`const db="${url}";`, "app.js");
    expect(f).toMatchObject({ patternId: "bundle_secret", severity: "critical" });
  });

  it("skips documented example keys", () => {
    expect(analyzeJavaScript('const k="AKIAIOSFODNN7EXAMPLE";', "docs.js")).toEqual([]);
  });

  it("lists internal and non-production hosts but not look-alike public ones", () => {
    const text = 'fetch("http://localhost:3000/api");fetch("https://api.staging.example.com");fetch("http://10.0.4.12:8080");fetch("https://developer.mozilla.org/docs");fetch("https://devtools.example.com")';
    const [f] = analyzeJavaScript(text, "app.js");
    expect(f.patternId).toBe("internal_endpoint");
    expect(f.match).toBe("http://localhost:3000, https://api.staging.example.com, http://10.0.4.12:8080");
  });

  it("returns nothing for a clean production bundle", () => {
    expect(analyzeJavaScript(minifiedSource(), "app.js")).toEqual([]);
  });
});

describe("analyzeWebFiles", () => {
  it("reports a shipped map once, through the map file, instead of also as a reference", () => {
    const map = JSON.stringify({ version: 3, mappings: "AAAA", sources: ["src/a.ts"], sourcesContent: ["x"] });
    const findings = analyzeWebFiles([
      file("assets/app.js", `${minifiedSource()}//# sourceMappingURL=app.js.map`),
      file("assets/app.js.map", map),
    ]);
    expect(ids(findings)).toEqual(["sourcemap_embeds_source"]);
    expect(findings[0].file).toBe("dist/assets/app.js.map");
  });

  it("resolves ../ references when matching maps", () => {
    const map = JSON.stringify({ version: 3, mappings: "AAAA", sources: ["src/a.ts"] });
    const findings = analyzeWebFiles([file("js/app.js", `${minifiedSource()}//# sourceMappingURL=../maps/app.js.map`), file("maps/app.js.map", map)]);
    expect(ids(findings)).toEqual(["sourcemap_shipped"]);
  });

  it("keeps the reference when the map is not part of the artifact", () => {
    expect(ids(analyzeWebFiles([file("app.js", `${minifiedSource()}//# sourceMappingURL=app.js.map`)]))).toEqual(["sourcemap_reference"]);
  });
});

describe("collapseRepeats", () => {
  it("reports one finding per distinct secret and says how far it spreads", () => {
    const chunk = 'const k="AKIAQ7XKZP3LMNB2RTUV";';
    const findings = analyzeWebFiles([file("a.js", chunk), file("b.js", chunk), file("c.js", chunk)]);
    expect(findings).toHaveLength(1);
    expect(findings[0].match).toContain("also in 2 other file(s)");
  });

  it("merges internal hosts across files and collapses long lists of unminified files", () => {
    const files = Array.from({ length: 7 }, (_, i) => file(`chunk${i}.js`, `${unminifiedSource()}\nfetch("http://localhost:${3000 + i}")`));
    const findings = analyzeWebFiles(files);
    expect(ids(findings)).toEqual(["internal_endpoint", "unminified_bundle"]);
    expect(findings.find((f) => f.patternId === "unminified_bundle")!.match).toBe("7 files, e.g. chunk0.js, chunk1.js, chunk2.js");
    expect(findings.find((f) => f.patternId === "internal_endpoint")!.match).toContain("— in 7 files");
  });

  it("leaves short lists alone", () => {
    const one = analyzeJavaScript(unminifiedSource(), "x.js");
    expect(collapseRepeats([...one, ...one])).toHaveLength(2);
  });
});
