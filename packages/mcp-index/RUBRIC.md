# GuardBee MCP Index — scoring rubric

**Rubric version: 2026-11.** Every published grade names the rubric version it was made with (`rubricVersion` in `index/v1.json`). A change to any number below is a new version, made in the same commit as the code ([`src/rubric.ts`](src/rubric.ts)), so a grade can always be traced to the rules that produced it.

## What is graded

Every server in the official MCP Registry (`registry.modelcontextprotocol.io`, latest version, status `active`) is graded once a week. The grade is made from the server's **published package**, which is the code that runs when the server is installed:

- the npm package if the registry entry has one, otherwise the PyPI package;
- the version is the one named in the registry entry, or the latest when none is named;
- the **package archive** (npm tarball; PyPI wheel, or the sdist when there is no wheel) is downloaded and read in memory. Nothing is installed or executed.

Not graded (shown with the reason, grade `–`):

- **hosted (remote-only) servers**: there is no package to read;
- **container-image-only servers**: images are not graded yet;
- entries whose package cannot be found or downloaded this week;
- servers whose authors opted out (see below).

## Score

A server starts at **100** and loses points for what is found, in three categories. The grade comes from the total:

| Grade | Score |
| --- | --- |
| A | 90–100 |
| B | 80–89 |
| C | 70–79 |
| D | 60–69 |
| F | 0–59 |

Each category also gets its own sub-score (100 minus that category's points), published next to the grade.

### Code (at most −60)

The shipped source files are scanned with the GuardBee static scanners, the same rules as the open-source packages. Only source that runs is scanned: `.js/.ts/.mjs/.cjs/.py/.go`; tests, examples, fixtures, docs, type declarations and minified single-line bundles are left out.

- [`@guardbee/mcp-tool-poisoning-scanner`](../tool-poisoning-scanner): hidden instructions in tool descriptions; tools that claim to be read-only but run a shell, write files or return the environment.
- [`@guardbee/mcp-server-auditor`](../mcp-server-auditor): tool input reaching shell, eval, file write, HTTP or SQL calls.
- [`@guardbee/mcp-oauth-auditor`](../oauth-auditor): token passthrough, missing audience checks, missing PKCE and the other MCP spec authorization pitfalls.
- [`@guardbee/mcp-secret-scanner`](../secret-scanner): credentials published in the package.

Points are counted **once per rule per package**, whatever the number of hits:

| Severity | Points |
| --- | --- |
| critical | −25 |
| high | −8 |
| medium | −2 |
| low | 0 |

### Supply chain

| Signal | Points | Source |
| --- | --- | --- |
| Known malicious package (`MAL-*` advisory) | −100 | [OSV.dev](https://osv.dev) (includes the OpenSSF malicious-packages feed) |
| Known vulnerability in this version | critical −40, high −20, medium −5, low −1, unrated −5 | OSV.dev (GHSA, PYSEC, …); CVSS v3 when no label |
| Install scripts (`preinstall`, `install`, `postinstall`) | −10 | npm package manifest |
| Build provenance present but not valid | −40 | npm provenance / PEP 740 attestation, verified with Sigstore |
| No build provenance | −5 | as above |

Provenance is verified cryptographically, as `guardbee-proxy provenance` does: the Sigstore bundle must verify against the public-good trust root, attest this exact artifact, and come from a workflow of the repository the package names.

### Maintenance and transparency

| Signal | Points |
| --- | --- |
| Package or version marked deprecated / yanked | −20 |
| No source repository (package metadata or registry entry) | −10 |
| No license | −5 |
| First published less than 30 days ago | −5 |
| This version is more than two years old | −5 |

### Caps

Some findings decide the grade, however good the rest is:

- known malicious package → score 0 (**F**);
- a credential (secret-scanner, high or critical) published in the package → at most 59 (**F**);
- any critical code finding or critical known vulnerability → at most 69 (**D**).

## What a grade does not say

A grade is a summary of automated checks on one published version. It is **not an audit** and not a guarantee:

- the scanners are pattern-based and can miss things or misread code (see each scanner's README for its limits);
- behavior that only shows at runtime (what a hosted endpoint does, what a server downloads later) is not seen;
- a package with no findings can still be unsuitable for your use.

Use the reasons published with each grade, not just the letter.

## Reproducing a grade

```bash
pnpm install && pnpm turbo run build --filter=@guardbee/mcp-index...
node packages/mcp-index/dist/cli.js crawl --out ./site --only io.github.owner/server
```

The result for one server is in `site/index/v1.json`. Advisory databases change, so a rerun later can differ when a new vulnerability has been published.

## Disputes and opt-out

See [README.md](README.md#disputes-and-opt-out).
