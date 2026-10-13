---
"@guardbee/mcp-dependency-auditor": minor
---

feat: audit Rust, Go, Ruby and PHP projects

`audit` and the `audit_directory` MCP tool now also read four more ecosystems:

| Ecosystem | File | Dev dependencies | Other handling |
|---|---|---|---|
| crates.io | `Cargo.lock` | from `[dev-dependencies]` in `Cargo.toml` | git crates skipped |
| Go | `go.mod` | — | `// indirect` modules have no path; `replace` directives applied; local replacements skipped |
| RubyGems | `Gemfile.lock` | from the `Gemfile`'s development/test groups | platform builds such as `nokogiri-1.19.4-x86_64-linux` merged into one release; GIT/PATH gems skipped |
| Packagist | `composer.lock` | `packages-dev` | `dev-*` branches skipped |

All four get dependency paths where the file records the graph, so Go is limited to direct modules.

Other changes:
- `audit-pkg` and `audit_package` accept `Packagist`.
- Fix versions keep the installed version style (`v0.10.0 → v0.38.0`).
- SARIF locations now point at the file each finding was read from (e.g. `pnpm-lock.yaml`, `Cargo.lock`) instead of always `package.json` / `requirements.txt` / `pom.xml`.
