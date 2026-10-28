# @guardbee/mcp-reverse-shield

## 0.2.0

### Minor Changes

- [#241](https://github.com/GuardBee/guardbee-mcp/pull/241) [`571d311`](https://github.com/GuardBee/guardbee-mcp/commit/571d311527260535d9b938ba2d952e6ddd587ae5) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - iOS (`.ipa` and `.app`: Debug-configuration builds, development profiles, React Native and web code), Android App Bundles (`.aab`), and engine checks for Unity (IL2CPP metadata, Mono assemblies), PyInstaller, Java/Spring Boot JARs and Flutter. New `suggest_fixes` tool / `suggest` command turns findings into build-config diffs (Vite, webpack, Next.js, Angular, CRA, Gradle, Android manifest, React Native, electron-builder, .NET). Baselines (`--baseline`, `--update-baseline`, SARIF `baselineState`), `ignore` rules in guardbee.yml, and a GitHub Action at `.github/actions/reverse-shield`.

## 0.1.1

### Patch Changes

- [#229](https://github.com/GuardBee/guardbee-mcp/pull/229) [`b8fa74f`](https://github.com/GuardBee/guardbee-mcp/commit/b8fa74f92932ec0ab503aff6e99184b1a3a9d1ba) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - First release through the Release workflow, so the package carries npm provenance like the rest of the family (0.1.0 was published by hand to register the Trusted Publisher).
