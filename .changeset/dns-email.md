---
"@guardbee/mcp-dns-intelligence": minor
---

feat: complete email security checks — DKIM key strength, MTA-STS, TLS-RPT, MX

**DKIM**
- ~35 selectors are probed (Microsoft, Google Workspace date selectors, SendGrid, Mailchimp, Resend, Zoho, Proton, Fastmail, …), and the RSA size is read from each published key.
- New findings:
  - `DKIM_KEY_WEAK` (under 1024 bits)
  - `DKIM_KEY_1024` (rotate to 2048, RFC 8301)
  - `DKIM_KEY_INVALID`
  - `DKIM_TESTING` (`t=y`)
  - `DKIM_KEY_REVOKED` (info)
- Extra `dkimSelectors` now also go through key analysis.
- `DKIM_NOT_FOUND` is no longer reported for domains that neither receive nor send mail.

**MTA-STS (RFC 8461)**
- The `_mta-sts` record is checked: present, single, and with `id=`.
- The policy file is fetched over HTTPS without following redirects.
- The policy's `mx:` patterns (one-label wildcards) are matched against the live MX hosts. An enforce policy that omits a live MX is `MTA_STS_MX_MISMATCH` (high), because compliant senders would refuse to deliver.
- Also flagged: testing or none mode, `max_age` under a day, and an unreachable or invalid policy.

**TLS-RPT**
- Expected alongside MTA-STS, with a `mailto:` or `https:` rua.

**MX**
- `MX_UNRESOLVABLE` when an MX host has no A/AAAA record (a SERVFAIL is not flagged).
- Null MX (`0 .`) is recognised.

**SPF severity change**
- A domain *with MX records* and no SPF is now **high**: anyone can send as it, and its own mail relies on DKIM alone. The finding includes a starting record for Google Workspace / Microsoft 365 MX hosts.
- A domain without MX gets **medium**, with a `v=spf1 -all` suggestion.
- **This can make `check` exit 1 where it exited 0 before**, at the default `--fail-on=high`.

**Report and tool**
- `check_email_security` now covers MX, SPF, DMARC, DKIM keys and MTA-STS/TLS-RPT.
- The CLI report shows DKIM key sizes and the MTA-STS/TLS-RPT state.
