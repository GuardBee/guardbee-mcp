---
"@guardbee/mcp-security-proxy": minor
"@guardbee/guard-core": minor
---

Build provenance check before a stdio upstream starts. The proxy resolves the npm package `npx` / `pnpm dlx` / `bunx` would run, verifies its Sigstore-signed SLSA provenance (signature against the Sigstore trust root, exact tarball hash, signing workflow of the named repository, matching `repository` field) and runs the command pinned to the checked version. `provenance.mode: warn` (default) logs unverified packages (`ruleId: provenance:*`), `require` refuses them, also per upstream. Results are cached per version (`~/.guardbee/provenance.json`; a changed tarball under a known version counts as tampering), `provenance.offline` works from the cache, and `guardbee-proxy provenance` checks a config without starting anything. PyPI and container images are reported (unpinned images by digest) but not yet verified. The proxy now needs Node.js 22.9 or later (Sigstore libraries). guard-core exports the dependency-free part: `parseLaunch`, `resolveNpmVersion`, `checkNpmProvenance` (signature check passed in), `normalizeRepositoryUrl`.
