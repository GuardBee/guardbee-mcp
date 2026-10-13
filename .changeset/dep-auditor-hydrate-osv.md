---
"@guardbee/mcp-dependency-auditor": patch
---

fix: fetch full OSV advisories so findings have real severity, summary, CVE aliases and fix versions

OSV's `querybatch` endpoint returns only `{ id, modified }` for each vulnerability. Every finding was therefore reported as UNKNOWN with no summary or fix, `--fail-on` never failed a build, and `ignore` entries given as CVE IDs never matched. The auditor now fetches each advisory from `/v1/vulns/{id}`. Fetches are de-duplicated, run in parallel, cached and retried on 429/5xx. The auditor also follows `next_page_token`, and it fails with an error instead of passing when an advisory cannot be fetched.
