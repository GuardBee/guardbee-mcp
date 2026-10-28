import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { patchOf, suggestFixes, unifiedDiff } from "../fixes.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "rs-fixes-"));
  dirs.push(root);
  for (const [p, data] of Object.entries(files)) {
    const full = join(root, ...p.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
  }
  return root;
}

/** Applies the suggested patch with real git and returns the resulting files. */
function applyPatch(root: string, files: string[]): Record<string, string> {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q");
  git("-c", "user.email=t@t", "-c", "user.name=t", "add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  writeFileSync(join(root, "fix.patch"), patchOf(suggestFixes(root)));
  git("apply", "fix.patch");
  return Object.fromEntries(files.map((f) => [f, readFileSync(join(root, ...f.split("/")), "utf8")]));
}

const byFile = (root: string) => Object.fromEntries(suggestFixes(root).suggestions.map((s) => [s.file, s]));

describe("unifiedDiff", () => {
  it("produces one hunk with context", () => {
    const diff = unifiedDiff("a.txt", "1\n2\n3\n4\n5\n6\n7\n8\n", "1\n2\n3\n4\nfive\n6\n7\n8\n");
    expect(diff).toBe("--- a/a.txt\n+++ b/a.txt\n@@ -2,7 +2,7 @@\n 2\n 3\n 4\n-5\n+five\n 6\n 7\n 8\n");
    expect(unifiedDiff("a", "same", "same")).toBe("");
  });

  it("does not invent a line for the final newline, and marks a missing one", () => {
    expect(unifiedDiff("a", "x\ny\n", "x\nz\n")).toBe("--- a/a\n+++ b/a\n@@ -1,2 +1,2 @@\n x\n-y\n+z\n");
    expect(unifiedDiff("a", "x\ny", "x\nz")).toBe("--- a/a\n+++ b/a\n@@ -1,2 +1,2 @@\n x\n-y\n\\ No newline at end of file\n+z\n\\ No newline at end of file\n");
  });
});

describe("web build configs", () => {
  it("switches Vite to hidden source maps and turns minification back on", () => {
    const root = project({ "vite.config.ts": "export default defineConfig({\n  build: {\n    sourcemap: true,\n    minify: false,\n  },\n});\n" });
    const out = applyPatch(root, ["vite.config.ts"]);
    expect(out["vite.config.ts"]).toContain("sourcemap: 'hidden',");
    expect(out["vite.config.ts"]).toContain("minify: 'esbuild',");
  });

  it("rewrites webpack devtools that ship maps or eval, and leaves hidden/false alone", () => {
    const root = project({
      "webpack.prod.js": "module.exports = { mode: 'production', devtool: 'eval-cheap-module-source-map', optimization: { minimize: false } };\n",
      "webpack.config.js": "module.exports = { devtool: 'hidden-source-map' };\n",
      "webpack.dev.js": "module.exports = { devtool: 'eval' };\n",
    });
    const s = byFile(root);
    expect(Object.keys(s)).toEqual(["webpack.prod.js"]);
    const out = applyPatch(root, ["webpack.prod.js"]);
    expect(out["webpack.prod.js"]).toBe("module.exports = { mode: 'production', devtool: 'hidden-source-map', optimization: { minimize: true } };\n");
  });

  it("turns off Next.js browser source maps and Angular production maps", () => {
    const root = project({
      "next.config.mjs": "export default {\n  productionBrowserSourceMaps: true,\n};\n",
      "angular.json": '{\n  "configurations": {\n    "development": {\n      "sourceMap": true\n    },\n    "production": {\n      "sourceMap": true,\n      "optimization": true\n    }\n  }\n}\n',
    });
    const out = applyPatch(root, ["next.config.mjs", "angular.json"]);
    expect(out["next.config.mjs"]).toContain("productionBrowserSourceMaps: false");
    expect(out["angular.json"]).toContain('"development": {\n      "sourceMap": true');
    expect(out["angular.json"]).toContain('"production": {\n      "sourceMap": false');
  });

  it("explains the CRA env switch only when it is missing", () => {
    expect(byFile(project({ "package.json": '{"dependencies":{"react-scripts":"5.0.1"}}' }))["package.json"].note).toContain("GENERATE_SOURCEMAP=false to .env.production");
    expect(suggestFixes(project({ "package.json": '{"dependencies":{"react-scripts":"5.0.1"}}', ".env.production": "GENERATE_SOURCEMAP=false\n" })).suggestions).toEqual([]);
  });
});

describe("Android", () => {
  it("edits buildTypes.release in Groovy, not the signing config of the same name", () => {
    const gradle = [
      "apply plugin: 'com.android.application'",
      "android {",
      "    signingConfigs {",
      "        release {",
      "            storeFile file('key.jks')",
      "        }",
      "    }",
      "    buildTypes {",
      "        release {",
      "            minifyEnabled false",
      "            debuggable true",
      "            signingConfig signingConfigs.release",
      "        }",
      "    }",
      "}",
      "",
    ].join("\n");
    const out = applyPatch(project({ "app/build.gradle": gradle }), ["app/build.gradle"]);
    expect(out["app/build.gradle"]).toContain("        release {\n            storeFile file('key.jks')\n        }");
    expect(out["app/build.gradle"]).toContain("        release {\n            minifyEnabled true\n            signingConfig signingConfigs.release\n        }");
  });

  it("adds R8 to a Kotlin DSL release block that has none", () => {
    const gradle = 'plugins { id("com.android.application") }\nandroid {\n    buildTypes {\n        getByName("release") {\n            signingConfig = signingConfigs.getByName("debug")\n        }\n    }\n}\n';
    const out = applyPatch(project({ "app/build.gradle.kts": gradle }), ["app/build.gradle.kts"]);
    expect(out["app/build.gradle.kts"]).toContain('getByName("release") {\n            isMinifyEnabled = true\n            isShrinkResources = true\n            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")\n            signingConfig');
  });

  it("leaves a release block that already minifies alone", () => {
    expect(suggestFixes(project({ "app/build.gradle.kts": 'android {\n    buildTypes {\n        release {\n            isMinifyEnabled = true\n        }\n    }\n}\n' })).suggestions).toEqual([]);
  });

  it("sets allowBackup in the main manifest, keeping multi-line attribute layout", () => {
    const manifest = '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application\n        android:label="Shop"\n        android:debuggable="true">\n    </application>\n</manifest>\n';
    const root = project({ "app/src/main/AndroidManifest.xml": manifest, "app/src/debug/AndroidManifest.xml": '<manifest><application android:label="dbg" /></manifest>\n' });
    expect(Object.keys(byFile(root))).toEqual(["app/src/main/AndroidManifest.xml"]);
    const out = applyPatch(root, ["app/src/main/AndroidManifest.xml"]);
    expect(out["app/src/main/AndroidManifest.xml"]).toBe('<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application\n        android:allowBackup="false"\n        android:label="Shop">\n    </application>\n</manifest>\n');
  });

  it("enables Hermes for React Native", () => {
    const out = applyPatch(project({ "android/gradle.properties": "org.gradle.jvmargs=-Xmx2048m\nhermesEnabled=false\n" }), ["android/gradle.properties"]);
    expect(out["android/gradle.properties"]).toContain("hermesEnabled=true");
  });
});

describe("Electron", () => {
  it("adds asar and fuses to electron-builder config in package.json", () => {
    const pkg = '{\n  "name": "app",\n  "devDependencies": {\n    "electron-builder": "^25.0.0"\n  },\n  "build": {\n    "appId": "x",\n    "asar": false\n  }\n}\n';
    const out = applyPatch(project({ "package.json": pkg }), ["package.json"]);
    const parsed = JSON.parse(out["package.json"]);
    expect(parsed.build.asar).toBe(true);
    expect(parsed.build.electronFuses).toMatchObject({ runAsNode: false, enableNodeCliInspectArguments: false, onlyLoadAppFromAsar: true });
  });

  it("appends fuses to electron-builder.yml and points Forge users at the plugin", () => {
    const root = project({ "electron-builder.yml": "appId: x\nasar: false\n", "forge.config.js": "module.exports = { plugins: [] };\n" });
    const out = applyPatch(root, ["electron-builder.yml"]);
    expect(out["electron-builder.yml"]).toBe("appId: x\nasar: true\nelectronFuses:\n  runAsNode: false\n  enableCookieEncryption: true\n  enableNodeOptionsEnvironmentVariable: false\n  enableNodeCliInspectArguments: false\n  enableEmbeddedAsarIntegrityValidation: true\n  onlyLoadAppFromAsar: true\n");
    expect(byFile(root)["forge.config.js"]).toMatchObject({ diff: "" });
    expect(byFile(root)["forge.config.js"].note).toContain("new FusesPlugin");
  });
});

describe(".NET and Flutter", () => {
  it("stops embedding the PDB and sources", () => {
    const out = applyPatch(project({ "src/App/App.csproj": "<Project>\n  <PropertyGroup>\n    <DebugType>embedded</DebugType>\n    <EmbedAllSources>true</EmbedAllSources>\n  </PropertyGroup>\n</Project>\n" }), ["src/App/App.csproj"]);
    expect(out["src/App/App.csproj"]).toContain("<DebugType>portable</DebugType>");
    expect(out["src/App/App.csproj"]).toContain("<EmbedAllSources>false</EmbedAllSources>");
  });

  it("gives Flutter build flags as a note", () => {
    const [s] = suggestFixes(project({ "pubspec.yaml": "name: shop\nflutter:\n  uses-material-design: true\n" })).suggestions;
    expect(s.note).toContain("--obfuscate --split-debug-info");
  });
});

describe("suggestFixes", () => {
  it("skips build output and dependencies, and lists what it read", () => {
    const root = project({
      "node_modules/x/vite.config.js": "export default { build: { sourcemap: true } }",
      "dist/next.config.js": "module.exports = { productionBrowserSourceMaps: true }",
      "vite.config.js": "export default { build: { sourcemap: 'hidden' } }",
    });
    const report = suggestFixes(root);
    expect(report.suggestions).toEqual([]);
    expect(report.inspected).toEqual(["vite.config.js"]);
  });

  it("rejects a path that is not a directory", () => {
    expect(() => suggestFixes(join(tmpdir(), "definitely-missing-rs-dir"))).toThrow(/Not a project directory/);
  });
});
