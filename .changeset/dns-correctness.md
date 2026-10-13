---
"@guardbee/mcp-dns-intelligence": minor
---

fix: count SPF lookups the way receivers do, filter wildcard DNS, parse DMARC robustly

**SPF**
- The lookup count read `-all`/`~all` as the `a` mechanism, so every record was over-counted by one.
- It also ignored nested includes. GitHub's record was reported as 9; receivers count 10.
- SPF is now evaluated through every `include`/`redirect`, following RFC 7208:
  - more than 10 lookups is `SPF_TOO_MANY_LOOKUPS`; exactly 10 is `SPF_AT_LOOKUP_LIMIT`
  - more than 2 void lookups is `SPF_TOO_MANY_VOID_LOOKUPS`
  - `SPF_INCLUDE_LOOP`, `SPF_INCLUDE_MISSING`, `SPF_INCLUDE_DUPLICATE`, `SPF_PTR`
- `v=spf1` is matched case-insensitively and no longer matches `v=spf10`.

**DMARC**
- Tags are case-insensitive, and values may contain `=`.
- An unknown `p=` is `DMARC_INVALID_POLICY`.
- `pct<100` is flagged for `reject` too, and `sp=none` is `DMARC_SUBDOMAINS_NONE`.
- Several records are `DMARC_MULTIPLE`; receivers ignore them all.
- Subdomains inherit the parent domain's record with its `sp=` policy.

**Wildcard DNS**
- `enumerate_subdomains` / `subdomains` probe two random labels first.
- Names answered only by `*.domain` are left out and counted. On `github.io` the wordlist reported 78 fake "live" subdomains.

**Other fixes**
- A domain that does not exist reports `DOMAIN_NOT_FOUND` instead of missing SPF/DMARC.
- Subdomains without an SOA are no longer flagged `NS_MISSING`.
- `zoneTransferVulnerable` is no longer reported as `false`; it was never checked.
- Domains given as URLs or with capitals or trailing dots are normalized; invalid input is an error.
- The CLI no longer truncates piped JSON. An explicit `--fail-on` overrides `guardbee.yml`, and invalid `--fail-on` / `--concurrency` values are errors.
- `enumerateDomain` / `enumerateSubdomains` accept an injectable resolver. `enumerateSubdomainsDetailed`, `evaluateSpf` and `normalizeDomain` are exported.
