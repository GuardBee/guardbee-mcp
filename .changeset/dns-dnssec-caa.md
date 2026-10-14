---
"@guardbee/mcp-dns-intelligence": minor
---

feat: DNSSEC and CAA checks

**DNSSEC**
- Read through DNS-over-HTTPS (dns.google), because Node's resolver cannot see DS/DNSKEY records or the AD flag. Only the domain name is sent.
- A validating query is compared with a `cd=1` (checking disabled) one. SERVFAIL only when validating is `DNSSEC_BROKEN` (critical): validating resolvers cannot resolve the domain at all. SERVFAIL both ways is reported as unchecked, not as a DNSSEC verdict.
- At zone apexes:
  - unsigned → `DNSSEC_DISABLED` (low)
  - DNSKEY without DS → `DNSSEC_NO_DS` (medium)
  - deprecated algorithms (RFC 8624) → `DNSSEC_WEAK_ALGORITHM`
  - a SHA-1-only DS → `DNSSEC_DS_SHA1`
- The apex is recognised from the SOA owner, so a CNAME'd host does not repeat its target's findings.

**CAA**
- The relevant set is found per RFC 8659 (nearest ancestor).
- No CAA → `CAA_MISSING` (low).
- An unknown critical tag → `CAA_UNKNOWN_CRITICAL` (high).
- The issuer of the certificate served on :443 is compared with the `issue` set. If that CA is not allowed, `CAA_BLOCKS_CURRENT_CA` (medium) warns that its renewal will fail.

**Report and API**
- Both checks appear in `check` / `enumerate_dns` and are skipped with `http: false`.
- New exports: `checkDnssec`, `checkCaa`, `findCaa`, `fetchIssuer`.
