---
"@guardbee/mcp-dns-intelligence": minor
---

feat: real subdomain takeover detection with verified provider fingerprints

The old check treated "CNAME target does not resolve" as dangling. That misses the most common cases: an unclaimed S3 bucket or GitHub Pages name still resolves, and only the HTTP response shows it is gone.

**How it checks**
- Every CNAME chain is followed, up to 5 hops.
- Each provider is matched by NXDOMAIN or by a page fingerprint. Every fingerprint was confirmed against a random unclaimed name on the provider.
- The wildcard record itself is checked: a dangling `*.domain` makes every unlisted name claimable.

**Risk levels**

| Level | Covers | Effect |
|---|---|---|
| takeover possible | S3, Azure, Elastic Beanstalk, Surge, and CNAMEs into an unregistered domain | counts as dangling |
| verify manually | GitHub Pages, Heroku, Netlify, Vercel, Ghost, Pantheon, WordPress.com, Help Scout, Tumblr, ngrok — all can require domain verification | counts as dangling |
| stale | the target is gone under a registered domain | listed with a cleanup note; does not fail CI |

A failed NS query is never taken as proof that a domain is unregistered.

**New tool and options**
- MCP tool `check_takeover` and CLI command `takeover <host…>`.
- `--no-http` / `httpProbe: false` turns off HTTP fingerprinting.
- New exports: `checkTakeover`, `FINGERPRINTS`.
