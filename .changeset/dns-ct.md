---
"@guardbee/mcp-dns-intelligence": minor
---

feat: discover subdomains from Certificate Transparency logs

`subdomains` and `enumerate_subdomains` now add hostnames found in Certificate Transparency logs to the 75-name wordlist.

**Sources and limits**
- crt.sh and Cert Spotter are queried in parallel, because each is regularly unavailable.
- crt.sh is retried once on a 5xx.
- Cert Spotter is paged with `?after=<id>`; the API's own next link drops the `/v1` prefix and 404s.
- A failure on a later Cert Spotter page keeps the names already collected.
- Wildcard certificate names are reduced to their zone, only names under the domain are kept, and the list is capped at 500.

**Checks on CT names**
- Every CT name goes through the same wildcard filter and takeover checks as wordlist names.
- Results are tagged `[CT]` when only CT found them.
- The report says which sources answered and how many CT names still resolve.

**Options and API**
- `--no-ct` / `certificateTransparency: false` uses the wordlist only.
- In the library API CT is opt-in: `ct: true`.
- New exports: `discoverFromCT`, `normalizeCtName`.
