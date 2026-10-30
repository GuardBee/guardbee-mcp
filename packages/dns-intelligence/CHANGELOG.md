# @guardbee/mcp-dns-intelligence

## 0.10.1

### Patch Changes

- [#247](https://github.com/GuardBee/guardbee-mcp/pull/247) [`30cc59d`](https://github.com/GuardBee/guardbee-mcp/commit/30cc59d169b9e0146e5ca785de7536c4dc4e98b9) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Tool schemas are now declared with `z.object(...)` instead of raw Zod shapes, which MCP SDK v2 deprecates. The JSON Schema sent to clients is unchanged.

## 0.10.0

### Minor Changes

- [#245](https://github.com/GuardBee/guardbee-mcp/pull/245) [`29bac2f`](https://github.com/GuardBee/guardbee-mcp/commit/29bac2f679cf97fd48d3d09eef80f328d77f5655) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Move to the MCP TypeScript SDK v2: every server now speaks MCP 2026-07-28 as well as 2025-11-25, choosing per connection (`serveStdio`). Tools without arguments no longer declare an empty input schema. The rug-pull detector and owasp-scan connect to target servers with version negotiation, so they read servers on either revision. `instrumentServer` from `@guardbee/mcp-telemetry` accepts an SDK v1 or v2 server.

### Patch Changes

- Updated dependencies [[`29bac2f`](https://github.com/GuardBee/guardbee-mcp/commit/29bac2f679cf97fd48d3d09eef80f328d77f5655)]:
  - @guardbee/mcp-telemetry@0.3.1

## 0.9.2

### Patch Changes

- [#189](https://github.com/GuardBee/guardbee-mcp/pull/189) [`d6b75fe`](https://github.com/GuardBee/guardbee-mcp/commit/d6b75fe26af9f074d87d92d063b6f355fdcc61d3) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - - **Node 22 for the proxy, document-scanner and security-suite** (`engines.node: ">=22"`): ldapts 9 and unpdf, which they depend on, require it. Node 18 and 20 are past end of life; the other packages still run on Node 18.
  - **`require()` works for every ESM package**: each `exports` entry gains a `default` condition next to `import` (Node 20.19+ / 22.12+ can `require()` ESM), so `require("@guardbee/mcp-secret-scanner")` no longer fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
  - **`guardbee-proxy --help` / `--version`** print usage and the version instead of failing with "No proxy target configured"; **`guardbee-gateway --help` / `--version`** no longer start the stdio server, and an unknown argument is an error.
  - The proxy's npm description starts with "MCP security gateway" again.

## 0.9.1

### Patch Changes

- [#178](https://github.com/GuardBee/guardbee-mcp/pull/178) [`c89dc93`](https://github.com/GuardBee/guardbee-mcp/commit/c89dc93bd04e53bc8b72806f279531676b8defcc) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - MCP tools are registered with `server.registerTool(name, { description, inputSchema, annotations }, handler)` instead of the deprecated `server.tool(...)` (132 registrations, no change to tool names, descriptions or parameters). `@modelcontextprotocol/sdk` is now required at `^1.30.0` instead of `^1.0.0` / `>=1.0.0`, so an install cannot resolve an old SDK the code was never tested with. `@guardbee/mcp-telemetry`'s `instrumentServer` wraps `registerTool` as well as `tool`.

- [#175](https://github.com/GuardBee/guardbee-mcp/pull/175) [`341a283`](https://github.com/GuardBee/guardbee-mcp/commit/341a2839d56a312f1cb1998a523eb7ea985345db) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Smaller npm packages (55% less unpacked in total; the proxy 944 → 513 kB): source maps and compiled tests are no longer published (the sources they point at never were), and the translated READMEs stay on GitHub, linked from the English one. Package descriptions now start with what people search for ("MCP gateway and LLM firewall", "Secret scanner for code, git history and AI agent transcripts") and carry more search keywords.
- Updated dependencies [[`12487ab`](https://github.com/GuardBee/guardbee-mcp/commit/12487abec2f0a8bc00b04fee1f8b62e64329c98b), [`c89dc93`](https://github.com/GuardBee/guardbee-mcp/commit/c89dc93bd04e53bc8b72806f279531676b8defcc), [`341a283`](https://github.com/GuardBee/guardbee-mcp/commit/341a2839d56a312f1cb1998a523eb7ea985345db)]:
  - @guardbee/mcp-telemetry@0.3.0

## 0.9.0

### Minor Changes

- [#172](https://github.com/GuardBee/guardbee-mcp/pull/172) [`9ae575f`](https://github.com/GuardBee/guardbee-mcp/commit/9ae575f89aa40b13463460504f12b70011c14947) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - `security-suite` now covers every GuardBee scanner and auditor (29 packages, 124 MCP tools). `guardbee serve` serves the recommended group by default (owasp-scan, secret-scanner, prompt-injection-scanner, toxic-flow-auditor, mcp-config-auditor, dependency-auditor: 31 tools); `--tools=` (or `GUARDBEE_SUITE_TOOLS`) takes groups (`code`, `supply-chain`, `network`, `platform`, `all`) and package ids. Tool names carry their package's prefix (`secrets_scan_text`, `injection_scan_text`) so packages do not collide. `guardbee <package-id> <args>` runs any package's CLI and `guardbee list` lists them; the old `secret-scan`, `dep-audit`, `ssl-inspect` and `dns-check` shortcuts still work. With no arguments and no terminal on stdin (an MCP client starting it), the suite now serves instead of printing help, and its MCP Registry entry passes `serve`.
  
  **Breaking for `guardbee serve` users:** the five plain tool names (`scan_directory`, `scan_file`, `audit_dependencies`, `inspect_ssl`, `check_dns`) are now prefixed package tools; see "Upgrading from 0.2" in the README.
  
  Every scanner and auditor package exports `registerTools(server)`, which registers its MCP tools on a given `McpServer`; `startServer()` uses it.

### Patch Changes

- [#170](https://github.com/GuardBee/guardbee-mcp/pull/170) [`c71f728`](https://github.com/GuardBee/guardbee-mcp/commit/c71f7284c88f36435d0b2f951d5f167781f89395) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Package hygiene: every package now ships its LICENSE and CHANGELOG.md, and has a homepage (its guardbee.ai page), a bugs link, `engines.node` and the `guardbee`, `mcp` and `security` keywords. READMEs gain npm badges and a feedback section pointing to GitHub Discussions; the owasp-scan README documents every mode, option, MCP tool and the OWASP coverage.
  
  **Telemetry is now opt-in.** Nothing is sent unless `GUARDBEE_TELEMETRY=1` (or `true`/`on`/`yes`) is set; `GUARDBEE_TELEMETRY=0` is no longer needed. When it is on, the one-time stderr notice says what is sent and to which endpoint.
- Updated dependencies [[`c71f728`](https://github.com/GuardBee/guardbee-mcp/commit/c71f7284c88f36435d0b2f951d5f167781f89395)]:
  - @guardbee/mcp-telemetry@0.2.0

## 0.8.0

### Minor Changes

- [#114](https://github.com/GuardBee/guardbee-mcp/pull/114) [`e8e4835`](https://github.com/GuardBee/guardbee-mcp/commit/e8e483501ff93f7fc6c945ebac76d0a14cbe7d59) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - feat: A–F grades, several domains per run, and SARIF for subdomain takeovers
  
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

## 0.7.0

### Minor Changes

- [#112](https://github.com/GuardBee/guardbee-mcp/pull/112) [`d9e2085`](https://github.com/GuardBee/guardbee-mcp/commit/d9e2085d817a3367b7950ecd4c0a5e9f21f7746d) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - feat: query nameservers directly — zone transfer, lame delegation, open resolvers
  
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

## 0.6.0

### Minor Changes

- [#109](https://github.com/GuardBee/guardbee-mcp/pull/109) [`43fa7d2`](https://github.com/GuardBee/guardbee-mcp/commit/43fa7d25161b9279431636bd32465fe82baf3d33) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - feat: DNSSEC and CAA checks
  
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

- [#97](https://github.com/GuardBee/guardbee-mcp/pull/97) [`237926d`](https://github.com/GuardBee/guardbee-mcp/commit/237926d457146f239cbc2d3243e0294ebc8f7176) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - feat: complete email security checks — DKIM key strength, MTA-STS, TLS-RPT, MX
  
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

## 0.5.0

### Minor Changes

- [#95](https://github.com/GuardBee/guardbee-mcp/pull/95) [`fec0601`](https://github.com/GuardBee/guardbee-mcp/commit/fec0601472df7fd1dfcd20b503703d42e2474e49) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - feat: discover subdomains from Certificate Transparency logs
  
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

## 0.4.0

### Minor Changes

- [#93](https://github.com/GuardBee/guardbee-mcp/pull/93) [`5302420`](https://github.com/GuardBee/guardbee-mcp/commit/53024202a7a7ba6f39ee6cadbf9224c4ad6a21ee) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - feat: real subdomain takeover detection with verified provider fingerprints
  
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

## 0.3.0

### Minor Changes

- [#91](https://github.com/GuardBee/guardbee-mcp/pull/91) [`8d264b7`](https://github.com/GuardBee/guardbee-mcp/commit/8d264b745d8d49560dc228aed707eada05a4b703) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - fix: count SPF lookups the way receivers do, filter wildcard DNS, parse DMARC robustly
  
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

## 0.2.4

### Patch Changes

- [#75](https://github.com/GuardBee/guardbee-mcp/pull/75) [`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - docs: add Chinese (ZH) README translation and short summaries in Japanese, Korean, Brazilian Portuguese, Spanish and German (JA.md, KO.md, PT-BR.md, ES.md, DE.md), with an eight-language switcher
- Updated dependencies [[`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed)]:
  - @guardbee/mcp-telemetry@0.1.4

## 0.2.2

### Patch Changes

- Fix each package's `repository` field to point at the actual monorepo (`github.com/GuardBee/guardbee-mcp`) with a `directory` pointing at its own subfolder. 9 packages still pointed at their old, now-archived standalone repos from before the 2026-09-11 monorepo migration (never updated); the 4 packages added since then pointed at the right repo but were missing `directory`. This mattered in practice, not just cosmetically: npm rewrites relative README links (e.g. the `TR.md` language-switcher link) using `repository.url` + `repository.directory`, so every package's Turkish-README link on npmjs.com was resolving to either a 404 (wrong/archived repo) or the wrong path (repo root instead of the package's subfolder). Also fixes `db-gateway`'s and `security-proxy`'s stale `bugs.url` and `db-gateway`'s stale `homepage`, and the same stale repository URL in `db-gateway/manifest.json`.
- Updated dependencies []:
  - @guardbee/mcp-telemetry@0.1.2

## 0.2.1

### Patch Changes

- Make English the primary `README.md` (what npm and GitHub display by default) for every package, matching the change already made for `db-gateway`. The previous Turkish content moves to `TR.md`, linked via a language switcher at the top of both files. Docs-only change, no code/behavior changes.
- Updated dependencies []:
  - @guardbee/mcp-telemetry@0.1.1

## 0.2.0

### Minor Changes

- [`8115d23`](https://github.com/GuardBee/guardbee-mcp/commit/8115d2343190febb3fa7101f5edec142c0b80967) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add usage telemetry via the new `@guardbee/mcp-telemetry` shared package — **on by default**, disable with `GUARDBEE_TELEMETRY=0`. Every tool call reports the tool name, a shape-preserving-redacted version of its parameters, success/failure, and duration to `app.guardbee.ai`.
  
  Redaction (`redactParams`, see `@guardbee/mcp-telemetry`'s README) replaces any string longer than 40 characters, and the value of any `content`/`text`/`data`/`filter`/`password`/`email`/`apiKey`/`token`/`secret` key regardless of length, with a `"[redacted: ...]"` placeholder — full file/scan content and real row data are never sent, only short structural parameters like table names or limits. A one-time notice is printed to stderr on first use explaining this and how to opt out. This is a behavior change (these packages now make an outbound network call by default) — previously most of them advertised running entirely offline.

### Patch Changes

- [`64eb8b0`](https://github.com/GuardBee/guardbee-mcp/commit/64eb8b0fa9425ab3b03fa9621737bda9a238519b) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add Smithery.ai integration files (`smithery.yaml`, `manifest.json`, `.well-known/mcp/server-card.json`), matching the pattern already used by `@guardbee/mcp-db-gateway`, so these servers are one-click installable from Smithery and discoverable via their MCP server card. No functional/runtime code changes — these files are read from the GitHub repo by Smithery, not from the published npm tarball (`package.json` `files` is unchanged).
