---
"@guardbee/mcp-dependency-auditor": minor
---

feat: correct fix versions and a one-upgrade-per-package fix plan

- **Branch-aware fix versions:** The fix version came from the first `fixed` event in an advisory, whatever the installed version. `next-auth@5.0.0-beta.31` was told to "upgrade" to `4.24.15`. Fix versions now follow the installed release line, and versions are ordered per ecosystem: SemVer for npm, crates.io and Go; PEP 440 for PyPI; Maven/RubyGems-style otherwise.
- **Fix plan:** The report and MCP output start with a fix plan that names, for each vulnerable package, the smallest listed version clearing every advisory. Examples: `log4j-core 2.14.1 → 2.25.4 (fixes 7/7)`, where 2.15.0 alone would leave six open. The plan also lists advisories that stay open and flags major-version jumps.
- **JSON:** Output adds `guardbee.upgrade` per package.
- **API:** `planUpgrade`, `isAffected` and `compareVersions` are exported. `getFixedVersion(vuln, name)` keeps its old behaviour; pass `version` and `ecosystem` for the branch-aware result.
