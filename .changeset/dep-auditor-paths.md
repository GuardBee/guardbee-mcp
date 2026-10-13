---
"@guardbee/mcp-dependency-auditor": minor
---

feat: show how each vulnerable package gets installed; stop double-counting duplicated releases

- **Dependency paths:** Findings now carry the shortest dependency path from a direct dependency, for example `Path : express@4.21.2 › proxy-addr@2.0.7`. Each fix-plan line names the direct dependency to bump (`← via express@4.21.2`). Paths are read from `package-lock.json` v2/v3 (using Node's `node_modules` resolution), pnpm v5/v6/v9, yarn v1/Berry, bun and uv lockfiles. SARIF messages and JSON (`path`) include them too.
- **Duplicate releases:** When a lockfile lists one release at several install paths, it is now queried and reported once. On a real 1,054-package project, 14 releases were listed more than once and `nanoid@3.3.16` was reported twice.
- **Mixed dev/prod copies:** A release with both a dev copy and a production copy is classified as production; before, the first copy seen decided.
