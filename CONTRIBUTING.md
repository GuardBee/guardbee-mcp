# Contributing

Thanks for helping. Bug reports, false positives, new detection rules and docs fixes are all welcome.

## Before you start

- **Security vulnerabilities:** see [SECURITY.md](SECURITY.md); do not open a public issue.
- **Questions and ideas:** [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions).
- **A bigger change** (a new package, a new config option, a change to a tool's parameters): open an issue first so we can agree on the shape.

## Setup

```bash
git clone https://github.com/GuardBee/guardbee-mcp.git
cd guardbee-mcp
pnpm install          # Node 22 and pnpm (corepack enable)
pnpm turbo run build test type-check
```

Each package lives in `packages/<name>` with its own `src/`, tests in `src/__tests__/` (Vitest) and a README in eight languages. `pnpm --filter <package> test` runs one package's tests.

## Making a change

1. Branch from `main`.
2. Add a test for the behaviour you change. A detection rule needs a case it must find and a similar case it must leave alone.
3. Run `pnpm turbo run build test type-check`.
4. Add a changeset: `pnpm changeset`, pick the packages, and describe the change for users in a sentence or two. It becomes the changelog entry.
5. Update the English README (and `TR.md` if you can) when behaviour or options change. Other languages can follow.
6. Open a pull request. CI builds, tests and scans it.

## Detection rules

- Precise over broad: a rule that fires on ordinary text costs users more than the miss it prevents. Mark patterns that also match ordinary text `broad: true` (see `packages/guard-core/README.md`).
- Validate what can be validated (checksums, prefixes, lengths) before reporting.
- Shared detectors belong in `@guardbee/guard-core`, so the scanners and the runtime proxy use the same rule.

## Releases

Maintainers merge the "Version Packages" pull request that Changesets opens; CI publishes to npm with provenance, to the MCP Registry, and creates GitHub releases. Never run `npm publish` by hand.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
