import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { basename, join, relative, sep } from "path";

export interface FixSuggestion {
  /** Path relative to the project directory, "/"-separated. */
  file: string;
  /** Checks this change addresses. */
  ruleIds: string[];
  title: string;
  /** Unified diff (`git apply`-compatible), or empty when the change cannot be expressed as one. */
  diff: string;
  /** Extra guidance: a snippet to add by hand, a build flag, a caveat. */
  note?: string;
}

export interface FixReport {
  project: string;
  suggestions: FixSuggestion[];
  /** Config files that were read. */
  inspected: string[];
}

const MAX_DEPTH = 4;
const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".gradle", "Pods", "DerivedData", "bin", "obj", ".turbo", "vendor"]);

function walk(dir: string, depth: number, onFile: (path: string) => void): void {
  if (depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP.has(e.name) && !e.name.startsWith(".")) walk(full, depth + 1, onFile);
    } else if (e.isFile()) {
      onFile(full);
    }
  }
}

// ── Diff ────────────────────────────────────────────────────────────────────

function splitLines(text: string): { lines: string[]; finalNewline: boolean } {
  const finalNewline = text.endsWith("\n");
  const lines = text.split("\n");
  if (finalNewline) lines.pop();
  return { lines, finalNewline };
}

/** One hunk covering every changed line, with three lines of context; enough for config edits. */
export function unifiedDiff(file: string, before: string, after: string): string {
  if (before === after) return "";
  const { lines: a, finalNewline: nlA } = splitLines(before);
  const { lines: b, finalNewline: nlB } = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  // Only a newline-at-EOF change: the last line differs in that respect alone.
  const eofOnly = nlA !== nlB;
  while (endA >= start && endB >= start && a[endA] === b[endB] && !(eofOnly && endA === a.length - 1)) {
    endA--;
    endB--;
  }
  const ctxStart = Math.max(0, start - 3);
  const ctxEndA = Math.min(a.length - 1, endA + 3);
  const ctxEndB = Math.min(b.length - 1, endB + 3);
  const out: string[] = [];
  const noNl = "\\ No newline at end of file";
  for (let i = ctxStart; i < start; i++) out.push(` ${a[i]}`);
  for (let i = start; i <= endA; i++) {
    out.push(`-${a[i]}`);
    if (i === a.length - 1 && !nlA) out.push(noNl);
  }
  for (let i = start; i <= endB; i++) {
    out.push(`+${b[i]}`);
    if (i === b.length - 1 && !nlB) out.push(noNl);
  }
  for (let i = endA + 1; i <= ctxEndA; i++) {
    out.push(` ${a[i]}`);
    if (i === a.length - 1 && !nlA) out.push(noNl);
  }
  const lenA = ctxEndA - ctxStart + 1;
  const lenB = ctxEndB - ctxStart + 1;
  return [`--- a/${file}`, `+++ b/${file}`, `@@ -${ctxStart + 1},${lenA} +${ctxStart + 1},${lenB} @@`, ...out].join("\n") + "\n";
}

// ── Fixers ──────────────────────────────────────────────────────────────────

type Fixer = (text: string, file: string, project: string) => Omit<FixSuggestion, "file" | "diff"> & { after?: string } | null;

const fixers: Array<{ match: (name: string, path: string) => boolean; fix: Fixer }> = [
  // Vite
  {
    match: (n) => /^vite\.config\.[cm]?[jt]s$/.test(n),
    fix: (text) => {
      const after = text
        .replace(/(\bsourcemap\s*:\s*)(true|["']inline["'])/g, "$1'hidden'")
        .replace(/(\bminify\s*:\s*)false\b/g, "$1'esbuild'");
      if (after === text) return null;
      return {
        after,
        ruleIds: ["sourcemap_shipped", "sourcemap_inline", "sourcemap_reference", "unminified_bundle"],
        title: "Vite: hidden source maps and minification for production builds",
        note: "'hidden' still writes .map files for your error tracker; delete them from the deployed output (or do not upload them).",
      };
    },
  },
  // webpack (not dev-only configs)
  {
    match: (n) => /^webpack(\.(prod|production|common|config))*\.config\.[cm]?[jt]s$|^webpack\.(prod|production)\.[cm]?[jt]s$/.test(n),
    fix: (text) => {
      const after = text
        .replace(/(\bdevtool\s*:\s*)(["'])([\w-]{1,60})\2/g, (m: string, pre: string, q: string, value: string) =>
          // Anything that ships a map or eval-wraps modules; leave hidden-*, false and nosources-* alone.
          !value.startsWith("hidden-") && !value.startsWith("nosources-") && (value.includes("source-map") || value.startsWith("eval")) ? `${pre}${q}hidden-source-map${q}` : m,
        )
        .replace(/(\bminimize\s*:\s*)false\b/g, "$1true");
      if (after === text) return null;
      return { after, ruleIds: ["sourcemap_inline", "eval_devtool_bundle", "sourcemap_reference", "unminified_bundle"], title: "webpack: hidden-source-map and minimisation for the production config" };
    },
  },
  // Next.js
  {
    match: (n) => /^next\.config\.[cm]?[jt]s$/.test(n),
    fix: (text) => {
      const after = text.replace(/(\bproductionBrowserSourceMaps\s*:\s*)true\b/g, "$1false");
      return after === text ? null : { after, ruleIds: ["sourcemap_shipped", "sourcemap_publicly_reachable"], title: "Next.js: stop publishing browser source maps" };
    },
  },
  // Angular
  {
    match: (n) => n === "angular.json",
    fix: (text) => {
      const prod = text.indexOf('"production"');
      if (prod === -1) return null;
      const block = text.indexOf("}", prod);
      const segment = text.slice(prod, block);
      const fixed = segment.replace(/("sourceMap"\s*:\s*)true\b/, "$1false");
      if (fixed === segment) return null;
      return { after: text.slice(0, prod) + fixed + text.slice(block), ruleIds: ["sourcemap_shipped"], title: "Angular: no source maps in the production configuration" };
    },
  },
  // Create React App: GENERATE_SOURCEMAP
  {
    match: (n) => n === "package.json",
    fix: (text, file, project) => {
      if (!/"react-scripts"\s*:/.test(text)) return null;
      const envProd = join(project, file.replace(/package\.json$/, ""), ".env.production");
      const existing = existsSync(envProd) ? readFileSync(envProd, "utf8") : null;
      if (existing && /^GENERATE_SOURCEMAP\s*=\s*false\s*$/m.test(existing)) return null;
      return {
        ruleIds: ["sourcemap_shipped"],
        title: "Create React App: set GENERATE_SOURCEMAP=false for production builds",
        note: `Add GENERATE_SOURCEMAP=false to ${relative(project, envProd).split(sep).join("/")}.`,
      };
    },
  },
  // Electron (electron-builder via package.json "build")
  {
    match: (n) => n === "package.json",
    fix: (text) => {
      if (!/"electron-builder"\s*:/.test(text) || /"electronFuses"\s*:/.test(text)) return null;
      const lines = text.split("\n");
      const i = lines.findIndex((l) => /^\s*"build"\s*:\s*\{\s*$/.test(l));
      if (i === -1) return null;
      const indent = (lines[i].match(/^\s*/)?.[0] ?? "") + "  ";
      // Flip an existing "asar" in place (removing it could strand a trailing comma); add it otherwise.
      const asarLine = lines.findIndex((l, j) => j > i && /^\s*"asar"\s*:\s*(true|false)\s*,?\s*$/.test(l));
      if (asarLine !== -1) lines[asarLine] = lines[asarLine].replace("false", "true");
      const block = [
        ...(asarLine === -1 ? [`${indent}"asar": true,`] : []),
        `${indent}"electronFuses": {`,
        `${indent}  "runAsNode": false,`,
        `${indent}  "enableCookieEncryption": true,`,
        `${indent}  "enableNodeOptionsEnvironmentVariable": false,`,
        `${indent}  "enableNodeCliInspectArguments": false,`,
        `${indent}  "enableEmbeddedAsarIntegrityValidation": true,`,
        `${indent}  "onlyLoadAppFromAsar": true`,
        `${indent}},`,
      ];
      lines.splice(i + 1, 0, ...block);
      return {
        after: lines.join("\n"),
        ruleIds: ["electron_fuse_run_as_node", "electron_fuse_inspect_args", "electron_fuse_node_options", "electron_fuse_asar_integrity_off", "electron_fuse_load_outside_asar", "electron_app_unpacked"],
        title: "electron-builder: package into app.asar and flip the security fuses",
        note: "electronFuses needs electron-builder 24.13 or later. If the app relies on ELECTRON_RUN_AS_NODE (e.g. to spawn helpers), keep runAsNode and use utilityProcess instead first.",
      };
    },
  },
  {
    match: (n) => /^electron-builder\.ya?ml$/.test(n),
    fix: (text) => {
      if (/^electronFuses\s*:/m.test(text) && !/^asar\s*:\s*false/m.test(text)) return null;
      let after = text.replace(/^asar\s*:\s*false\s*$/m, "asar: true");
      if (!/^electronFuses\s*:/m.test(after)) {
        after = `${after.replace(/\n*$/, "\n")}electronFuses:\n  runAsNode: false\n  enableCookieEncryption: true\n  enableNodeOptionsEnvironmentVariable: false\n  enableNodeCliInspectArguments: false\n  enableEmbeddedAsarIntegrityValidation: true\n  onlyLoadAppFromAsar: true\n`;
      }
      return {
        after,
        ruleIds: ["electron_fuse_run_as_node", "electron_fuse_inspect_args", "electron_fuse_node_options", "electron_fuse_asar_integrity_off", "electron_fuse_load_outside_asar", "electron_app_unpacked"],
        title: "electron-builder: package into app.asar and flip the security fuses",
        note: "electronFuses needs electron-builder 24.13 or later.",
      };
    },
  },
  {
    match: (n) => /^forge\.config\.[cm]?[jt]s$/.test(n),
    fix: (text) => {
      if (/FusesPlugin/.test(text)) return null;
      return {
        ruleIds: ["electron_fuse_run_as_node", "electron_fuse_inspect_args", "electron_fuse_node_options", "electron_fuse_asar_integrity_off", "electron_fuse_load_outside_asar"],
        title: "Electron Forge: add the fuses plugin",
        note: [
          "Install @electron-forge/plugin-fuses and @electron/fuses, then add to plugins:",
          "  new FusesPlugin({ version: FuseVersion.V1, [FuseV1Options.RunAsNode]: false, [FuseV1Options.EnableCookieEncryption]: true,",
          "    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, [FuseV1Options.EnableNodeCliInspectArguments]: false,",
          "    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true, [FuseV1Options.OnlyLoadAppFromAsar]: true })",
        ].join("\n"),
      };
    },
  },
  // Android Gradle
  {
    match: (n) => n === "build.gradle" || n === "build.gradle.kts",
    fix: (text, file) => {
      if (!/com\.android\.application|android\s*\{/.test(text)) return null;
      const kts = file.endsWith(".kts");
      const lines = text.split("\n");
      // Only inside buildTypes: signingConfigs usually has a "release" block too.
      const buildTypes = lines.findIndex((l) => /^\s*buildTypes\s*\{\s*$/.test(l));
      if (buildTypes === -1) return null;
      const offset = lines.slice(buildTypes + 1).findIndex((l) => /^\s*(getByName\(\s*"release"\s*\)|release)\s*\{\s*$/.test(l));
      if (offset === -1) return null;
      const rel = buildTypes + 1 + offset;
      // The release block ends at the first line back at its indentation.
      const indent = lines[rel].match(/^\s*/)?.[0] ?? "";
      let end = rel + 1;
      while (end < lines.length && !(lines[end].startsWith(`${indent}}`) && lines[end].trim() === "}")) end++;
      const body = lines.slice(rel + 1, end);
      const inner = `${indent}    `;
      const minifyRe = kts ? /^\s*isMinifyEnabled\s*=\s*(true|false)/ : /^\s*minifyEnabled\s*(=\s*)?(true|false)/;
      const debugRe = kts ? /^\s*isDebuggable\s*=\s*true/ : /^\s*debuggable\s*(=\s*)?true/;
      let changed = false;
      const newBody = body
        .filter((l) => {
          if (debugRe.test(l)) {
            changed = true;
            return false;
          }
          return true;
        })
        .map((l) => {
          if (minifyRe.test(l) && /false/.test(l)) {
            changed = true;
            return l.replace("false", "true");
          }
          return l;
        });
      if (!newBody.some((l) => minifyRe.test(l))) {
        changed = true;
        newBody.unshift(
          kts ? `${inner}isMinifyEnabled = true` : `${inner}minifyEnabled true`,
          kts ? `${inner}isShrinkResources = true` : `${inner}shrinkResources true`,
          kts
            ? `${inner}proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")`
            : `${inner}proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'`,
        );
      }
      if (!changed) return null;
      return {
        after: [...lines.slice(0, rel + 1), ...newBody, ...lines.slice(end)].join("\n"),
        ruleIds: ["apk_no_obfuscation", "apk_debuggable"],
        title: "Android: R8 on and debuggable off for the release build type",
        note: "Run the release build and its tests after enabling R8; classes used through reflection (serialisation, DI) may need -keep rules in proguard-rules.pro.",
      };
    },
  },
  // React Native: Hermes
  {
    match: (n, p) => n === "gradle.properties" && p.split(sep).includes("android"),
    fix: (text) => {
      const after = text.replace(/^(hermesEnabled\s*=\s*)false\s*$/m, "$1true");
      return after === text ? null : { after, ruleIds: ["apk_js_bundle_plaintext"], title: "React Native: ship the bundle as Hermes bytecode" };
    },
  },
  // AndroidManifest
  {
    match: (n) => n === "AndroidManifest.xml",
    fix: (text, file) => {
      let after = text.replace(/\s+android:debuggable\s*=\s*"true"/g, "");
      // A missing allowBackup only matters in the main manifest; debug/flavor
      // overlays inherit it, so there only an explicit "true" is wrong.
      const isMain = file.includes("/src/main/") || !file.includes("/src/");
      if (/android:allowBackup\s*=\s*"true"/.test(after)) after = after.replace(/android:allowBackup\s*=\s*"true"/, 'android:allowBackup="false"');
      else if (isMain && /<application\b/.test(after) && !/android:allowBackup\s*=/.test(after)) {
        after = after.replace(/<application\b([^>]*)>/, (m: string, attrs: string) => {
          const indent = (attrs.match(/\n(\s+)android:/)?.[1]) ?? " ";
          const sepr = attrs.includes("\n") ? `\n${indent}` : " ";
          return `<application${sepr}android:allowBackup="false"${attrs}>`;
        });
      }
      if (after === text) return null;
      return {
        after,
        ruleIds: ["apk_allow_backup", "apk_debuggable"],
        title: "Android manifest: no backup of app data, no hard-coded debuggable",
        note: "If the app relies on Auto Backup, keep it and exclude sensitive files with android:dataExtractionRules instead.",
      };
    },
  },
  // .NET
  {
    match: (n) => /\.(cs|fs|vb)proj$/.test(n) || n === "Directory.Build.props",
    fix: (text) => {
      const after = text
        .replace(/<DebugType>\s*embedded\s*<\/DebugType>/gi, "<DebugType>portable</DebugType>")
        .replace(/<EmbedAllSources>\s*true\s*<\/EmbedAllSources>/gi, "<EmbedAllSources>false</EmbedAllSources>");
      if (after === text) return null;
      return {
        after,
        ruleIds: ["dotnet_embedded_pdb"],
        title: ".NET: keep the PDB (and sources) out of the shipped assembly",
        note: "portable writes a separate .pdb; leave it out of the published output, or use <DebugType>none</DebugType> for Release. Obfuscation is a separate step (e.g. Obfuscar in the publish pipeline).",
      };
    },
  },
  // Flutter: build flags, not a config file
  {
    match: (n) => n === "pubspec.yaml",
    fix: (text) => {
      if (!/^\s*flutter\s*:/m.test(text)) return null;
      return {
        ruleIds: ["native_symbols_not_stripped"],
        title: "Flutter: obfuscate Dart code and split debug info at build time",
        note: "Build releases with: flutter build apk --obfuscate --split-debug-info=build/symbols (same flags for appbundle/ipa). Keep build/symbols private for crash symbolication.",
      };
    },
  },
];

/**
 * Reads a project's build configuration and proposes the changes that close
 * the exposures reverse-shield reports, as diffs to review and apply. It
 * never writes files.
 */
export function suggestFixes(projectDir: string): FixReport {
  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) throw new Error(`Not a project directory: ${projectDir}`);
  const suggestions: FixSuggestion[] = [];
  const inspected: string[] = [];

  walk(projectDir, 0, (full) => {
    const name = basename(full);
    const matching = fixers.filter((f) => f.match(name, full));
    if (matching.length === 0) return;
    const rel = relative(projectDir, full).split(sep).join("/");
    let text: string;
    try {
      if (statSync(full).size > 2 * 1024 * 1024) return;
      text = readFileSync(full, "utf8");
    } catch {
      return;
    }
    inspected.push(rel);
    for (const f of matching) {
      const result = f.fix(text, rel, projectDir);
      if (!result) continue;
      const { after, ...rest } = result;
      suggestions.push({ file: rel, diff: after !== undefined ? unifiedDiff(rel, text, after) : "", ...rest });
    }
  });

  return { project: projectDir, suggestions, inspected: inspected.sort() };
}

export function formatFixReport(report: FixReport): string {
  if (report.suggestions.length === 0) {
    return `✅ No changes to suggest in ${report.inspected.length} build config file(s)${report.inspected.length ? `: ${report.inspected.join(", ")}` : " (none recognised)"}.`;
  }
  const lines = [`🔧 ${report.suggestions.length} suggested change(s) from ${report.inspected.length} build config file(s). Nothing was modified.`, ""];
  for (const s of report.suggestions) {
    lines.push(`## ${s.title}`, `File: ${s.file}`, `Addresses: ${s.ruleIds.join(", ")}`);
    if (s.diff) lines.push("```diff", s.diff.trimEnd(), "```");
    if (s.note) lines.push(s.note);
    lines.push("");
  }
  return lines.join("\n");
}

/** All diffs concatenated, ready for `git apply`. */
export function patchOf(report: FixReport): string {
  return report.suggestions.map((s) => s.diff).filter(Boolean).join("");
}
