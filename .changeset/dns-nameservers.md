---
"@guardbee/mcp-dns-intelligence": minor
---

feat: query nameservers directly — zone transfer, lame delegation, open resolvers

`check` / `enumerate_dns` now query each nameserver of a zone directly over DNS. A small RFC 1035 wire codec handles this, because Node's resolver cannot address one server, read the AA/RA flags or do AXFR.

**What is checked**
- `NS_AXFR_ALLOWED` (high): an anonymous zone transfer succeeds. Only the first TCP messages are read; the zone is never downloaded. `zoneTransferVulnerable` is now a real result.
- `NS_LAME` (high): a listed server answers REFUSED, SERVFAIL, without the AA flag, or not at all.
- `NS_UNRESOLVABLE` (high): a nameserver's own name has no address.
- `NS_OPEN_RESOLVER` (medium): the server answers recursive queries for a name it does not host.
- `NS_SOA_SERIAL_MISMATCH` (low): serials differ. Serials are compared only between servers of the same primary (SOA MNAME), so multi-provider setups such as NS1 + Route 53 are not flagged.

**Options**
- Skip with `--no-ns-probe` / `nameserverProbe: false` (`nsProbe: false` in the API).
- The transport is injectable.
