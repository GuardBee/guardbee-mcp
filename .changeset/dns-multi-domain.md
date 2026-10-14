---
"@guardbee/mcp-dns-intelligence": minor
---

feat: A–F grades, several domains per run, and SARIF for subdomain takeovers

**Grades**
- Every report starts with an A–F grade.
- Points are deducted per finding (critical 40, high 20, medium 8, low 2), and the worst finding caps the grade: critical → F, high → at most C, medium → at most B.
- A domain that does not exist is F.

**Several domains**
- `check` takes several domains. Without arguments it now checks every domain in `guardbee.yml` (before: only the first).
- Text output ends with a summary table sorted worst first.
- JSON returns `{ domains: [...] }` for several domains and adds `grade` to each result.
- SARIF covers all domains in one run.
- The exit code fails if any domain fails `--fail-on`.

**SARIF for subdomain takeovers**
- `subdomains --format=sarif` reports takeovers as `SUBDOMAIN_TAKEOVER` / `WILDCARD_TAKEOVER` (high when claimable, medium when verification may protect it) and stale CNAMEs as low.
- Info findings are no longer emitted to SARIF.

**MCP and API**
- New MCP tool `audit_domains`: up to 20 domains, with a grade table and each domain's top findings.
- New exports: `gradeFindings`, `formatGradeTable`, `buildSarifMulti`, `subdomainFindings`.
