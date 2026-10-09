---
"@guardbee/mcp-secret-scanner": minor
---

Git history and staged scanning, and baselines. `scan --history[=<range>]` scans every line any commit added (a key deleted from the files is still found, once, at the commit that added it, with author and date); `scan --staged` scans only what is about to be committed. `--write-baseline` records findings as hashes (never the secrets) and `--baseline` reports only new ones. Findings carry a stable `fingerprint` (rule + path relative to the scan root + secret, hashed), which SARIF exposes as `partialFingerprints`. New MCP tool `scan_git`; `scan_directory` accepts `baseline`.
