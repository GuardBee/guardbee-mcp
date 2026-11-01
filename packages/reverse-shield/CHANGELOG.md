# @guardbee/mcp-reverse-shield

## 0.5.0

### Minor Changes

- [#276](https://github.com/GuardBee/guardbee-mcp/pull/276) [`17686c6`](https://github.com/GuardBee/guardbee-mcp/commit/17686c6339bee9b3fa6eb272c65236d45121b443) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Flutter apps are now judged on Dart obfuscation: `flutter_not_obfuscated` (high) when the AOT snapshot (`libapp.so`, `App.framework/App`) keeps the program's class and method names, measured by the share of two- and three-letter identifiers `--obfuscate` leaves (1% without the flag, 31–37% with it on Dart SDK snapshots). WebAssembly modules in bundles, build folders, APK assets, ASARs and iOS apps are checked for DWARF (`wasm_debug_info`, high), a function-name section (`wasm_name_section`, medium) and a `sourceMappingURL`. iOS bundles that carry `.dSYM` debug symbols get `ios_dsym_shipped` (high). `suggest_fixes`' Flutter instructions now answer `flutter_not_obfuscated`.

### Patch Changes

- Updated dependencies [[`2b600e1`](https://github.com/GuardBee/guardbee-mcp/commit/2b600e19a04dd645100937dd713685b01bd8ecba), [`ca17dea`](https://github.com/GuardBee/guardbee-mcp/commit/ca17dea9e1167efcbe36ac0c8b73b3fe3ca941ae), [`fb81d57`](https://github.com/GuardBee/guardbee-mcp/commit/fb81d57371b9e06a3ff6c05a8877717276e51a89)]:
  - @guardbee/guard-core@1.5.0

## 0.4.0

### Minor Changes

- [#262](https://github.com/GuardBee/guardbee-mcp/pull/262) [`de1b35d`](https://github.com/GuardBee/guardbee-mcp/commit/de1b35d8ec7144d15b52f91cd9e314cdb8abf084) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Credentials are now found outside JavaScript too: Android dex strings, the `resources.arsc` / `resources.pb` string pool, `assets/` and `res/raw/`; iOS plists (`GoogleService-Info.plist`) and the main executable; JSON, plist, `.env`, properties and YAML files inside an ASAR, a JAR (Spring Boot `application.properties`) or a build folder; Hermes bytecode, `.so` libraries and native/.NET binaries. Findings keep the `bundle_secret` id, so existing `ignore` rules and baselines still apply, and carry the target they were found in. A Google/Firebase API key in an Android or iOS package is reported as medium with a note to restrict it, since those ship by design. One key found in several files of a scan (dex and a `.so`, every ABI) is one finding.

### Patch Changes

- Updated dependencies [[`de1b35d`](https://github.com/GuardBee/guardbee-mcp/commit/de1b35d8ec7144d15b52f91cd9e314cdb8abf084)]:
  - @guardbee/guard-core@1.4.1

## 0.3.1

### Patch Changes

- [#247](https://github.com/GuardBee/guardbee-mcp/pull/247) [`30cc59d`](https://github.com/GuardBee/guardbee-mcp/commit/30cc59d169b9e0146e5ca785de7536c4dc4e98b9) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Tool schemas are now declared with `z.object(...)` instead of raw Zod shapes, which MCP SDK v2 deprecates. The JSON Schema sent to clients is unchanged.

## 0.3.0

### Minor Changes

- [#245](https://github.com/GuardBee/guardbee-mcp/pull/245) [`29bac2f`](https://github.com/GuardBee/guardbee-mcp/commit/29bac2f679cf97fd48d3d09eef80f328d77f5655) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Move to the MCP TypeScript SDK v2: every server now speaks MCP 2026-07-28 as well as 2025-11-25, choosing per connection (`serveStdio`). Tools without arguments no longer declare an empty input schema. The rug-pull detector and owasp-scan connect to target servers with version negotiation, so they read servers on either revision. `instrumentServer` from `@guardbee/mcp-telemetry` accepts an SDK v1 or v2 server.

### Patch Changes

- Updated dependencies [[`29bac2f`](https://github.com/GuardBee/guardbee-mcp/commit/29bac2f679cf97fd48d3d09eef80f328d77f5655)]:
  - @guardbee/mcp-telemetry@0.3.1

## 0.2.0

### Minor Changes

- [#241](https://github.com/GuardBee/guardbee-mcp/pull/241) [`571d311`](https://github.com/GuardBee/guardbee-mcp/commit/571d311527260535d9b938ba2d952e6ddd587ae5) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - iOS (`.ipa` and `.app`: Debug-configuration builds, development profiles, React Native and web code), Android App Bundles (`.aab`), and engine checks for Unity (IL2CPP metadata, Mono assemblies), PyInstaller, Java/Spring Boot JARs and Flutter. New `suggest_fixes` tool / `suggest` command turns findings into build-config diffs (Vite, webpack, Next.js, Angular, CRA, Gradle, Android manifest, React Native, electron-builder, .NET). Baselines (`--baseline`, `--update-baseline`, SARIF `baselineState`), `ignore` rules in guardbee.yml, and a GitHub Action at `.github/actions/reverse-shield`.

## 0.1.1

### Patch Changes

- [#229](https://github.com/GuardBee/guardbee-mcp/pull/229) [`b8fa74f`](https://github.com/GuardBee/guardbee-mcp/commit/b8fa74f92932ec0ab503aff6e99184b1a3a9d1ba) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - First release through the Release workflow, so the package carries npm provenance like the rest of the family (0.1.0 was published by hand to register the Trusted Publisher).
