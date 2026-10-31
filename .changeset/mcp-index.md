---
"@guardbee/guard-core": minor
"@guardbee/mcp-config-auditor": minor
"@guardbee/mcp-security-proxy": minor
---

GuardBee MCP Index: A–F trust grades for the servers in the official MCP Registry, rebuilt weekly from their published packages (static scan with the GuardBee scanners, OSV vulnerabilities and malware, Sigstore build provenance, maintenance; rubric in packages/mcp-index/RUBRIC.md).

- guard-core: `loadMcpIndex` (downloads the whole index, cached for a day, so lookups send no names), `lookupMcpGrade` (by what a command launches: npm, PyPI, image), `gradeBelow`, `isMcpGrade`, index types.
- mcp-config-auditor: `--grades` on `scan <file>` and `discover` shows each server's grade; `--min-grade=<A-F>` reports servers below it (`mcp_index_grade_below_minimum`, MCP04); `--index-url`, `--offline`.
- security-proxy: `guardbee-proxy init --grades` shows the grades; `--min-grade <A-F>` leaves servers below it out of both the gateway and the client config (they stay in the backup).
