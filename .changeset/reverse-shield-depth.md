---
"@guardbee/mcp-reverse-shield": minor
---

Flutter apps are now judged on Dart obfuscation: `flutter_not_obfuscated` (high) when the AOT snapshot (`libapp.so`, `App.framework/App`) keeps the program's class and method names, measured by the share of two- and three-letter identifiers `--obfuscate` leaves (1% without the flag, 31–37% with it on Dart SDK snapshots). WebAssembly modules in bundles, build folders, APK assets, ASARs and iOS apps are checked for DWARF (`wasm_debug_info`, high), a function-name section (`wasm_name_section`, medium) and a `sourceMappingURL`. iOS bundles that carry `.dSYM` debug symbols get `ios_dsym_shipped` (high). `suggest_fixes`' Flutter instructions now answer `flutter_not_obfuscated`.
