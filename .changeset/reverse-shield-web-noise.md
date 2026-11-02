---
"@guardbee/mcp-reverse-shield": minor
---

Quieter live URL scans and a server-free entry point.

- `scanUrl` skips platform-served scripts (HubSpot, WordPress core) and open-source libraries, and ignores reachable source maps that only cover dependencies.
- Internal-host findings on a live page keep private IPs, internal TLDs and the site's own staging hosts; `localhost` URLs shipped by frameworks are dropped.
- Supabase `anon` JWTs are no longer reported as credentials (`service_role` still is); Google browser keys in web pages are reported as medium with referrer-restriction guidance.
- New `@guardbee/mcp-reverse-shield/scan` export with the scanners but without `@modelcontextprotocol/server`; both entry points now also resolve for `require()` on Node 22+.
