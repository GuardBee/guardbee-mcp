# @guardbee/mcp-reverse-shield

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
