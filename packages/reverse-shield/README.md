# @guardbee/mcp-reverse-shield

**🇬🇧 English** | [🇹🇷 Türkçe](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/reverse-shield/TR.md) | [🇨🇳 中文](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/reverse-shield/ZH.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-reverse-shield.svg)](https://www.npmjs.com/package/@guardbee/mcp-reverse-shield)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-reverse-shield.svg)](https://www.npmjs.com/package/@guardbee/mcp-reverse-shield)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/reverse-shield/LICENSE)

An MCP server that tells you **how much your shipped app gives a reverse engineer for free**.

Reverse-engineering MCPs now let an agent take an app it has no source for — a web bundle, an Electron app, an APK, an iOS app, a game, a native or .NET binary — and explain how a feature works, down to the binary. This package is the other side of that: point it at *your own* build artifact and it reports what such a tool (or a person with jadx, ILSpy, Il2CppDumper, Hopper or the browser's devtools) would get without any effort, with the fix for each — and `suggest_fixes` turns those fixes into a diff against your build config.

> Telemetry is **off** by default. With `GUARDBEE_TELEMETRY=1` it sends the server, tool, success, duration and short parameter values such as a file path; longer strings and fields like `content`, `token` or `password` are replaced with a placeholder. See [`@guardbee/mcp-telemetry`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/telemetry/README.md).

```
Claude ──► reverse-shield ──► your build artifact / live site
              │
              ├─ web       source maps (shipped, inline, publicly reachable), unminified / dev bundles, keys, internal hosts, WebAssembly debug info and names
              ├─ electron  fuses (RunAsNode, --inspect, NODE_OPTIONS, ASAR integrity), unpacked app code, code inside app.asar
              ├─ android   APK and AAB: debuggable, R8/ProGuard missing, signing scheme, backup, plain React Native bundle, unstripped .so
              ├─ ios       IPA and .app: Debug-configuration builds, development profiles, plain React Native bundle, .dSYM in the bundle, the executable
              ├─ engines   Unity (IL2CPP metadata, Mono assemblies), PyInstaller, Java/Spring Boot JARs, Flutter (Dart obfuscation)
              ├─ native    debug info, symbols, get-task-allow, hardened runtime, signing, PIE/NX/RELRO/canary (ELF, Mach-O, PE)
              ├─ secrets   keys in everything above: dex, resources.arsc, plists, config files, Hermes bytecode, .so and executables
              └─ .NET      obfuscation missing, embedded PDB, leaked build paths
```

Everything runs locally and offline (except `scan_url`), with its own parsers for ASAR, the Electron fuse wire, binary AndroidManifest (AXML), DEX, ELF, Mach-O (including universal binaries and code signatures) and PE/.NET metadata — no apktool, jadx or binutils needed.

## What it flags

| Check | Severity | Target | What it gives away |
|---|---|---|---|
| `sourcemap_embeds_source` | critical | web | Full original source via `sourcesContent` |
| `sourcemap_shipped` / `sourcemap_inline` / `sourcemap_publicly_reachable` | high | web | Original file paths and structure |
| `eval_devtool_bundle` | high | web | Dev bundle with each module's path |
| `bundle_secret` | per key type | all | A working credential in client code, an app package or a binary |
| `wasm_debug_info` | high | web | WebAssembly with DWARF: source files, lines, types |
| `unminified_bundle` / `dev_build_framework` / `wasm_name_section` | medium | web | Readable code / framework dev runtime / named WebAssembly functions |
| `sourcemap_reference` / `internal_endpoint` | low | web | Where the map lives / localhost, private IPs, staging hosts |
| `electron_fuse_run_as_node` / `electron_fuse_inspect_args` | high | electron | Node runtime or debugger inside the signed app |
| `electron_app_unpacked` | high | electron | App code as an editable folder |
| `electron_fuse_node_options` / `_asar_integrity_off` / `_load_outside_asar` | medium | electron | Code injection and ASAR tampering |
| `apk_debuggable` | critical | android | Debugger attach and `run-as` into app data |
| `apk_no_obfuscation` / `apk_js_bundle_plaintext` / `apk_unsigned` | high | android | jadx output with real names / readable RN bundle / no tamper evidence |
| `apk_allow_backup` / `apk_v1_only_signature` | medium | android | Data pulled via backup / Janus-style repackaging |
| `native_debug_info` / `native_debuggable_entitlement` | high | native | Source-level debug data / lldb attach |
| `native_symbols_not_stripped` / `native_no_hardened_runtime` / `native_injection_entitlement` / `native_unsigned` | medium | native | Named functions / dylib injection / patched copies run |
| `native_no_pie` / `native_no_nx` | medium | native | Exploit-friendly fixed addresses / executable stack |
| `native_no_relro` / `native_no_stack_canary` / `native_adhoc_signed` / `native_build_path_leak` | low | native | Hardening gaps and build-host details |
| `ios_debug_build` / `ios_js_bundle_plaintext` / `ios_dsym_shipped` | high | ios | Unoptimised code with full symbols and preview stubs / readable RN bundle / full DWARF symbols in the bundle |
| `ios_development_profile` | medium | ios | Debugger attach on registered devices |
| `unity_il2cpp_metadata` / `unity_mono_assemblies` | high | engines | Every class, method and string of the game / C# scripts via dnSpy |
| `flutter_not_obfuscated` | high | engines | Dart class and method names for blutter / reFlutter |
| `python_pyinstaller_bundle` / `java_not_obfuscated` | high | engines | Decompilable `.pyc` files / Java classes with original names |
| `dotnet_not_obfuscated` / `dotnet_embedded_pdb` | high | .NET | ILSpy/dnSpy output close to the original source |

`list_checks` returns the full catalog with fixes. Every result carries an **A–F grade**: F when anything critical (or several high findings) is exposed, A when nothing is.

### How the trickier checks decide

- **R8/ProGuard**: reads class descriptors from every `classes*.dex` and looks at classes under your application id (and under the packages of components your manifest names, for `.debug`-style ids). Dozens of descriptive class names with almost no one- or two-letter names means R8 did not run.
- **.NET obfuscation**: reads the metadata `#Strings` heap. Known obfuscator markers (ConfuserEx, Dotfuscator, SmartAssembly, …) pass immediately; otherwise an assembly passes when at least 10% of its identifiers are one- or two-letter names, bare numbers or non-ASCII junk. Checked against an Obfuscar build (21%, passes) and 400 unobfuscated NuGet assemblies (383 flagged; the other 17 are resource-only assemblies with too few names to judge).
- **Private keys**: only reported when base64 key material follows the PEM header — crypto libraries bundled into apps carry the header as a string constant.
- **Credentials outside JavaScript**: Android dex strings, the `resources.arsc` / `resources.pb` string pool (where `strings.xml` and google-services values end up), `assets/` and `res/raw/`; iOS plists (`GoogleService-Info.plist`) and the executable; JSON/plist/`.env`/properties/YAML files in an ASAR, a JAR (Spring Boot `application.properties`) or a build folder; Hermes bytecode, `.so` libraries and native/.NET binaries by their printable strings. Only fixed-format keys are matched there, as in bundles. A Google/Firebase API key in an Android or iOS package is reported as medium: those ship by design and must be restricted to the app's package name or bundle id.
- **Repeats**: one key in 30 chunks is one finding (“also in 29 other files”), and long lists of unminified files collapse into one.
- **iOS Debug builds**: Xcode 16 puts a Debug build's code in `<App>.debug.dylib` next to `__preview.dylib`; either one in a bundle means the Debug configuration was shipped.
- **Unity**: IL2CPP's `global-metadata.dat` is flagged only when its standard header is intact (protected builds encrypt it); a Mono `Assembly-CSharp.dll` goes through the .NET name check.
- **PyInstaller**: the CArchive cookie is searched across the whole file (on macOS the archive sits in its own section before the code signature); PyArmor and Nuitka builds are noted, not flagged.
- **Flutter**: reads the identifiers in the AOT snapshot (`libapp.so`, `App.framework/App`). `--obfuscate` renames everything the program defines to two- or three-letter names while the Dart VM's own names stay, so a snapshot passes when at least 10% of its identifiers are that short. Checked against one program built both ways with the Dart SDK's `gen_snapshot`: 1% without the flag, 31% (unstripped) and 37% (stripped) with it. Fewer than 200 identifiers is a note, not a verdict.
- **WebAssembly**: custom sections only — `.debug_*` (DWARF), `name` (function names) and `sourceMappingURL`; the code itself is not judged.
- **React Native with Hermes**: noted, not flagged. Hermes bytecode disassembles (hermes-dec, hbctool), but how much it gives away depends on whether the bundle was minified first, which is not measured yet.

## Quick start

```json
{
  "mcpServers": {
    "guardbee-reverse-shield": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-reverse-shield"]
    }
  }
}
```

Then ask your agent: *“How easy is it to reverse engineer `./release/MyApp.app`? Fix what you can in the build config.”*

```bash
npx @guardbee/mcp-reverse-shield scan ./dist --fail-on=high
npx @guardbee/mcp-reverse-shield scan ./app/build/outputs/apk/release/app-release.apk
npx @guardbee/mcp-reverse-shield scan "/Applications/My App.app" --format=json
npx @guardbee/mcp-reverse-shield scan https://app.example.com --format=sarif > reverse-shield.sarif
npx @guardbee/mcp-reverse-shield scan ./build/MyApp.ipa
npx @guardbee/mcp-reverse-shield suggest . --format=patch | git apply   # review first: suggest . prints the same as text
```

## Tools

| Tool | Purpose |
|---|---|
| `scan_artifact` | Scan a file or directory: APK, AAB, IPA, iOS or macOS `.app`, Electron folder, `app.asar`, JAR, ELF/Mach-O/PE/.NET binary, JS bundle, source map, or a build output folder (Unity and Python builds included). Optional `ignore` and `baseline` |
| `suggest_fixes` | Read the project's build config (Vite, webpack, Next.js, Angular, CRA, Android Gradle and manifest, React Native, electron-builder / Forge, .NET project files, Flutter) and return the changes as unified diffs. Never writes files |
| `scan_url` | Fetch a live page, check its same-site bundles, follow `sourceMappingURL` and probe `<bundle>.map` (third-party scripts are not fetched) |
| `list_checks` | The check catalog with what each finding gives away and how to fix it |

Directories are walked including `dist/`, `build/` and `out/` (that is the point); `node_modules`, VCS and cache folders are skipped, and a macOS `.app` or Electron folder found inside is scanned as one unit — its fuses, its ASAR and its own executable, not the bundled third-party frameworks.

`guardbee.yml`:

```yaml
reverse-shield:
  fail-on: high
  max-files: 5000
  baseline: .reverse-shield-baseline.json
  exclude:
    - "vendor/"
  ignore:                       # accepted exposures: a rule id, or rule:path-substring
    - bundle_secret:firebase-config.js
```

## CI and baselines

Record what the current release exposes, then let CI fail only on what a change adds:

```bash
npx @guardbee/mcp-reverse-shield scan ./dist --update-baseline          # writes .reverse-shield-baseline.json
npx @guardbee/mcp-reverse-shield scan ./dist --baseline=.reverse-shield-baseline.json --fail-on=high
# Compared to baseline (grade C → D): 1 new, 2 fixed, 4 unchanged
```

Findings are matched by check and location, with bundler content hashes (`index-BvL4J5f8.js`, `7321-dd7cb90a7de65945.js`) normalised, so a rebuild does not make old findings look new. SARIF results carry `baselineState` (`new` / `unchanged`).

The repository ships a composite action that scans, uploads SARIF, writes a job summary and exposes `grade` / `new-findings` outputs:

```yaml
- uses: GuardBee/guardbee-mcp/.github/actions/reverse-shield@main
  with:
    target: dist
    fail-on: high
    baseline: .reverse-shield-baseline.json
```

## Limits

- Obfuscation is judged from names, not control flow: a build that only renames passes, and string encryption or control-flow flattening is not measured.
- Web checks look at what is shipped; they cannot tell whether a key is meant to be public (some, like Firebase web keys, are restricted server-side). Rotate or restrict it, then accept it with an `ignore` entry (`bundle_secret:firebase-config.js`).
- Strings are read from dex and resource tables by their structure, from other binaries as printable runs; a key split across string constants, encrypted or assembled at runtime is not found (that is the point of doing so, but it only slows a reverse engineer down).
- Native hardening checks (PIE/NX/RELRO/canary) are exploit-mitigation signals rather than reverse-engineering ones; they are reported low/medium for that reason.
- App Store IPAs are FairPlay-encrypted on distribution; the scanner reads the IPA you export (development, ad hoc or App Store export before Apple encrypts it), which is what a jailbroken device would also yield.
- `suggest_fixes` edits the common shapes of each config; unusual layouts (computed webpack configs, Gradle convention plugins) get no diff, and Forge and Flutter get instructions rather than a patch. Always review before applying.

## License

MIT
