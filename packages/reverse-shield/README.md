# @guardbee/mcp-reverse-shield

**🇬🇧 English** | [🇹🇷 Türkçe](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/reverse-shield/TR.md) | [🇨🇳 中文](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/reverse-shield/ZH.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-reverse-shield.svg)](https://www.npmjs.com/package/@guardbee/mcp-reverse-shield)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-reverse-shield.svg)](https://www.npmjs.com/package/@guardbee/mcp-reverse-shield)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/reverse-shield/LICENSE)

An MCP server that tells you **how much your shipped app gives a reverse engineer for free**.

Reverse-engineering MCPs now let an agent take an app it has no source for — a web bundle, an Electron app, an APK, a native or .NET binary — and explain how a feature works, down to the binary. This package is the other side of that: point it at *your own* build artifact and it reports what such a tool (or a person with jadx, ILSpy, Hopper or the browser's devtools) would get without any effort, with the fix for each.

> Telemetry is **off** by default. With `GUARDBEE_TELEMETRY=1` it sends the server, tool, success, duration and short parameter values such as a file path; longer strings and fields like `content`, `token` or `password` are replaced with a placeholder. See [`@guardbee/mcp-telemetry`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/telemetry/README.md).

```
Claude ──► reverse-shield ──► your build artifact / live site
              │
              ├─ web       source maps (shipped, inline, publicly reachable), unminified / dev bundles, keys, internal hosts
              ├─ electron  fuses (RunAsNode, --inspect, NODE_OPTIONS, ASAR integrity), unpacked app code, code inside app.asar
              ├─ android   debuggable, R8/ProGuard missing, signing scheme, backup, plain React Native bundle, unstripped .so
              ├─ native    debug info, symbols, get-task-allow, hardened runtime, signing, PIE/NX/RELRO/canary (ELF, Mach-O, PE)
              └─ .NET      obfuscation missing, embedded PDB, leaked build paths
```

Everything runs locally and offline (except `scan_url`), with its own parsers for ASAR, the Electron fuse wire, binary AndroidManifest (AXML), DEX, ELF, Mach-O (including universal binaries and code signatures) and PE/.NET metadata — no apktool, jadx or binutils needed.

## What it flags

| Check | Severity | Target | What it gives away |
|---|---|---|---|
| `sourcemap_embeds_source` | critical | web | Full original source via `sourcesContent` |
| `sourcemap_shipped` / `sourcemap_inline` / `sourcemap_publicly_reachable` | high | web | Original file paths and structure |
| `eval_devtool_bundle` | high | web | Dev bundle with each module's path |
| `bundle_secret` | per key type | web | A working credential in client code |
| `unminified_bundle` / `dev_build_framework` | medium | web | Readable code / framework dev runtime |
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
| `dotnet_not_obfuscated` / `dotnet_embedded_pdb` | high | .NET | ILSpy/dnSpy output close to the original source |

`list_checks` returns the full catalog with fixes. Every result carries an **A–F grade**: F when anything critical (or several high findings) is exposed, A when nothing is.

### How the trickier checks decide

- **R8/ProGuard**: reads class descriptors from every `classes*.dex` and looks at classes under your application id (and under the packages of components your manifest names, for `.debug`-style ids). Dozens of descriptive class names with almost no one- or two-letter names means R8 did not run.
- **.NET obfuscation**: reads the metadata `#Strings` heap. Known obfuscator markers (ConfuserEx, Dotfuscator, SmartAssembly, …) pass immediately; otherwise an assembly passes when at least 10% of its identifiers are one- or two-letter names, bare numbers or non-ASCII junk. Checked against an Obfuscar build (21%, passes) and 400 unobfuscated NuGet assemblies (383 flagged; the other 17 are resource-only assemblies with too few names to judge).
- **Private keys**: only reported when base64 key material follows the PEM header — crypto libraries bundled into apps carry the header as a string constant.
- **Repeats**: one key in 30 chunks is one finding (“also in 29 other files”), and long lists of unminified files collapse into one.

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
```

## Tools

| Tool | Purpose |
|---|---|
| `scan_artifact` | Scan a file or directory: APK, `.app`, Electron folder, `app.asar`, ELF/Mach-O/PE/.NET binary, JS bundle, source map, or a build output folder |
| `scan_url` | Fetch a live page, check its same-site bundles, follow `sourceMappingURL` and probe `<bundle>.map` (third-party scripts are not fetched) |
| `list_checks` | The check catalog with what each finding gives away and how to fix it |

Directories are walked including `dist/`, `build/` and `out/` (that is the point); `node_modules`, VCS and cache folders are skipped, and a macOS `.app` or Electron folder found inside is scanned as one unit — its fuses, its ASAR and its own executable, not the bundled third-party frameworks.

`guardbee.yml`:

```yaml
reverse-shield:
  fail-on: high
  max-files: 5000
  exclude:
    - "vendor/"
```

## CI

```yaml
- run: npx @guardbee/mcp-reverse-shield scan ./dist --fail-on=high --format=sarif > reverse-shield.sarif
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: reverse-shield.sarif
```

## Limits

- Obfuscation is judged from names, not control flow: a build that only renames passes, and string encryption or control-flow flattening is not measured.
- Web checks look at what is shipped; they cannot tell whether a key is meant to be public (some, like Firebase web keys, are restricted server-side). Rotate or restrict, then add the path to `exclude`.
- Native hardening checks (PIE/NX/RELRO/canary) are exploit-mitigation signals rather than reverse-engineering ones; they are reported low/medium for that reason.
- iOS `.ipa` and Android App Bundles (`.aab`) are not unpacked yet; scan the `.app` inside the `.ipa`, or a universal APK built from the bundle.

## License

MIT
