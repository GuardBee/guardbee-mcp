---
"@guardbee/mcp-dependency-auditor": minor
---

feat: read exact versions from pnpm, yarn, bun, uv, Poetry and Pipenv lockfiles

The auditor now reads `pnpm-lock.yaml` (v5/v6/v9), `yarn.lock` (v1 and Berry), `bun.lock` and `npm-shrinkwrap.json` alongside `package-lock.json`, and `uv.lock`, `poetry.lock` and `Pipfile.lock` for Python. Projects using these package managers were previously audited only on the direct dependencies in `package.json` or `requirements.txt`, with versions guessed from ranges. They are now audited on every locked package, including transitive ones.

When the lockfile does not mark dev packages (pnpm v9, yarn, bun, uv), they are told apart by walking the dependency graph from the project's production and dev roots. `--include-dev` / `includeDevDeps` now also applies to Python dev groups. Workspace members in `package-lock.json` are no longer sent to OSV as registry packages. In text mode the CLI prints which file each ecosystem was read from.
