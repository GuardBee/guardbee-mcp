---
"@guardbee/mcp-dependency-auditor": minor
---

feat: flag known-malicious package versions; merge duplicate advisories; stop truncating piped JSON/SARIF output

- **Malware:** OpenSSF `MAL-*` records carry no severity score, so they were reported as UNKNOWN and passed `--fail-on`. The hijacked `chalk@5.6.1` from September 2025 exited 0. Releases with a `MAL-*` ID or alias, or an advisory classified CWE-506, are now critical. They are listed first with a removal and credential-rotation action, tagged `malicious` in SARIF, and marked `guardbee.malicious` in JSON.
- **Duplicates:** OSV often returns one issue under several IDs that alias each other (GHSA + PYSEC for PyPI, GHSA + MAL for malware). They are now merged into one finding. `requests@2.19.0` reports 5 vulnerabilities instead of 10. The merged record keeps every ID, so `ignore` entries still match any of them.
- **Truncated output:** The CLI called `process.exit()` right after writing the report, which cut piped output at 64 KB and left `--format=json | jq` with invalid JSON on larger projects. It now sets `process.exitCode` and lets stdout drain.
- **JSON annotations:** Each finding in JSON output now carries `guardbee: { severity, malicious, fixedVersion }`, the verdict the CLI acted on.
