# GuardBee MCP Index

An A–F trust grade for every server in the [official MCP Registry](https://registry.modelcontextprotocol.io), rebuilt every week from the server's published package and published at **https://guardbee.github.io/guardbee-mcp/**.

- **Search page:** `https://guardbee.github.io/guardbee-mcp/`
- **Data:** `https://guardbee.github.io/guardbee-mcp/index/v1.json` (the whole index, one file)
- **Rubric:** [RUBRIC.md](RUBRIC.md), versioned. Every grade names the rubric version that made it.

This package is the crawler and scorer. It is not published to npm; it runs weekly in [`.github/workflows/mcp-index.yml`](../../.github/workflows/mcp-index.yml).

## What goes into a grade

For each registry entry with an npm or PyPI package, the package archive is downloaded and read in memory. Nothing is installed or run. The grade combines three things, detailed in [RUBRIC.md](RUBRIC.md):

- **Code.** The shipped source is checked with the GuardBee scanners: tool poisoning, tool input reaching dangerous calls, OAuth pitfalls, and published secrets.
- **Supply chain.** Known malware and vulnerabilities come from OSV.dev. Build provenance (npm provenance or PEP 740) is verified with Sigstore. Install scripts count against the package.
- **Maintenance and transparency.** Deprecation, source repository, license, package age, and release age.

Each grade is published with its score, three sub-scores, and the list of reasons that took points off.

Some servers are listed without a grade, with the reason shown:
- hosted (remote-only) servers;
- container-image-only servers;
- packages that could not be downloaded that week;
- servers whose authors opted out.

## Using the grades

- **`@guardbee/mcp-config-auditor`:** `scan <mcp.json> --grades` / `discover --grades` shows a grade for every configured server. `--min-grade=C` reports the ones below C.
- **`@guardbee/mcp-security-proxy`:** `guardbee-proxy init --grades` shows the grades. `--min-grade C` leaves out servers below C when moving a client's servers behind the gateway.
- **Your own code:** `loadMcpIndex()` and `lookupMcpGrade()` from `@guardbee/guard-core`.

Lookups never send anything about your setup. The clients download the whole index (cached for a day) and search it locally, so no server or package name leaves the machine.

### Badge

Every server has a [shields.io endpoint](https://shields.io/badges/endpoint-badge):

```markdown
![GuardBee MCP Index](https://img.shields.io/endpoint?url=https://guardbee.github.io/guardbee-mcp/badges/<slug>.json)
```

`<slug>` is the registry name with every character other than letters, digits, `.`, `_` and `-` replaced by `_`. For example, `io.github.owner/server` becomes `io.github.owner_server`.

## Disputes and opt-out

Server authors can open a [dispute or opt-out issue](https://github.com/GuardBee/guardbee-mcp/issues/new?template=mcp-index-dispute.yml). Disputes are answered within 7 days.

- **A wrong finding** (false positive) is fixed in the scanner, not by editing one grade, so every server benefits from the fix. The corrected grade appears in the next weekly run, or earlier if the workflow is re-run.
- **Out-of-date data** (a fixed vulnerability, a new version) is picked up by the next weekly run. A grade always describes the version named in the registry entry.
- **Opt-out:** the server is added to [`optout.json`](optout.json) once the request is confirmed to come from a maintainer, either through a comment from the repository owner's account or a commit to the server's repository. It is then listed as "opted out by the author", with no grade.

## Running it

```bash
pnpm install && pnpm turbo run build --filter=@guardbee/mcp-index...
node packages/mcp-index/dist/cli.js crawl --out ./site                        # the whole registry
node packages/mcp-index/dist/cli.js crawl --out ./site --only io.github.o/s   # one server
node packages/mcp-index/dist/cli.js crawl --out ./site --limit 100            # the first 100
```

Requests carry the user agent `GuardBee-MCP-Index/1` and back off on 429/5xx responses.
