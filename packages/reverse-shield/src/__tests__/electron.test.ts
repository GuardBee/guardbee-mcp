import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { readAsar } from "../asar.js";
import { analyzeElectron, describeFuses, detectElectron, fuseFindings, parseFuseWire, readFuseWire } from "../electron.js";
import { buildAsar, buildFuseBinary } from "./testFixtures.js";

const ids = (fs: { patternId: string }[]) => fs.map((f) => f.patternId).sort();
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "rs-electron-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Electron's defaults: RunAsNode on, cookie encryption off, NODE_OPTIONS on, inspect on, integrity off, only-asar off
const DEFAULT_FUSES = "10110000";
// What a hardened app (e.g. via @electron/fuses) ships
const HARDENED_FUSES = "01001100";

function macApp(fuses: string, asarFiles: Record<string, string> | null, appDir?: Record<string, string>): string {
  const app = join(tmp(), "Demo.app");
  const fw = join(app, "Contents", "Frameworks", "Electron Framework.framework");
  mkdirSync(fw, { recursive: true });
  writeFileSync(join(fw, "Electron Framework"), buildFuseBinary(fuses));
  const resources = join(app, "Contents", "Resources");
  mkdirSync(resources, { recursive: true });
  if (asarFiles) writeFileSync(join(resources, "app.asar"), buildAsar(asarFiles));
  if (appDir) {
    for (const [p, text] of Object.entries(appDir)) {
      const full = join(resources, "app", ...p.split("/"));
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, text);
    }
  }
  return app;
}

describe("fuse wire", () => {
  it("parses version and states after the sentinel", () => {
    const buf = buildFuseBinary(DEFAULT_FUSES, 10);
    expect(parseFuseWire(buf, 10)).toEqual({ version: 1, states: DEFAULT_FUSES });
  });

  it("finds the wire inside a large file", () => {
    const dir = tmp();
    const bin = join(dir, "Electron Framework");
    writeFileSync(bin, buildFuseBinary(HARDENED_FUSES, 17 * 1024 * 1024));
    expect(readFuseWire(bin)?.states).toBe(HARDENED_FUSES);
  });

  it("returns null when there is no fuse wire", () => {
    const dir = tmp();
    writeFileSync(join(dir, "bin"), Buffer.alloc(4096));
    expect(readFuseWire(join(dir, "bin"))).toBeNull();
  });

  it("reports every unsafe default fuse", () => {
    expect(ids(fuseFindings({ version: 1, states: DEFAULT_FUSES }, "bin"))).toEqual([
      "electron_fuse_asar_integrity_off",
      "electron_fuse_inspect_args",
      "electron_fuse_load_outside_asar",
      "electron_fuse_node_options",
      "electron_fuse_run_as_node",
    ]);
  });

  it("reports nothing for hardened fuses, and treats removed fuses as safe", () => {
    expect(fuseFindings({ version: 1, states: HARDENED_FUSES }, "bin")).toEqual([]);
    expect(fuseFindings({ version: 1, states: "r0rr11" }, "bin")).toEqual([]);
  });

  it("describes fuse states by name", () => {
    expect(describeFuses({ version: 1, states: "1r" })).toBe("RunAsNode=on, EnableCookieEncryption=removed");
  });
});

describe("readAsar", () => {
  it("lists nested files and reads their contents", () => {
    const dir = tmp();
    const asar = join(dir, "app.asar");
    writeFileSync(asar, buildAsar({ "package.json": '{"main":"main.js"}', "dist/main.js": "console.log(1)", "dist/deep/x.js": "y()" }));
    const files = readAsar(asar)!;
    expect(files.map((f) => f.key).sort()).toEqual(["dist/deep/x.js", "dist/main.js", "package.json"]);
    expect(files.find((f) => f.key === "dist/deep/x.js")!.read()!.toString()).toBe("y()");
    expect(files[0].display).toContain("app.asar!/");
  });

  it("returns null for something that is not an ASAR", () => {
    const dir = tmp();
    writeFileSync(join(dir, "x.asar"), Buffer.from("definitely not an archive"));
    expect(readAsar(join(dir, "x.asar"))).toBeNull();
  });
});

describe("analyzeElectron", () => {
  it("combines fuse findings with the code inside app.asar", () => {
    const map = JSON.stringify({ version: 3, mappings: "AAAA", sources: ["src/main.ts"], sourcesContent: ["x"] });
    const app = macApp(DEFAULT_FUSES, {
      "package.json": "{}",
      "dist/main.js": "a()//# sourceMappingURL=main.js.map",
      "dist/main.js.map": map,
      "node_modules/dep/index.js": 'fetch("http://localhost:1")',
    });
    const layout = detectElectron(app)!;
    expect(layout.fuseBinary).toContain("Electron Framework");
    const result = analyzeElectron(layout, 100);
    expect(ids(result.findings)).toEqual([
      "electron_fuse_asar_integrity_off",
      "electron_fuse_inspect_args",
      "electron_fuse_load_outside_asar",
      "electron_fuse_node_options",
      "electron_fuse_run_as_node",
      "sourcemap_embeds_source",
    ]);
    expect(result.notes.join("\n")).toContain("RunAsNode=on");
  });

  it("flags app code shipped as a plain resources/app folder", () => {
    const app = macApp(HARDENED_FUSES, null, { "package.json": "{}", "main.js": "start()" });
    const result = analyzeElectron(detectElectron(app)!, 100);
    expect(ids(result.findings)).toEqual(["electron_app_unpacked"]);
    expect(result.findings[0].match).toBe("no app.asar");
  });

  it("detects a Windows/Linux layout by its resources folder", () => {
    const dir = tmp();
    mkdirSync(join(dir, "resources"));
    writeFileSync(join(dir, "resources", "app.asar"), buildAsar({ "package.json": "{}" }));
    const layout = detectElectron(dir);
    expect(layout).not.toBeNull();
    expect(layout!.fuseBinary).toBeNull(); // no executable large enough to be Electron
    expect(detectElectron(tmp())).toBeNull();
  });
});
