---
"@guardbee/mcp-reverse-shield": minor
---

Credentials are now found outside JavaScript too: Android dex strings, the `resources.arsc` / `resources.pb` string pool, `assets/` and `res/raw/`; iOS plists (`GoogleService-Info.plist`) and the main executable; JSON, plist, `.env`, properties and YAML files inside an ASAR, a JAR (Spring Boot `application.properties`) or a build folder; Hermes bytecode, `.so` libraries and native/.NET binaries. Findings keep the `bundle_secret` id, so existing `ignore` rules and baselines still apply, and carry the target they were found in. A Google/Firebase API key in an Android or iOS package is reported as medium with a note to restrict it, since those ship by design. One key found in several files of a scan (dex and a `.so`, every ABI) is one finding.
