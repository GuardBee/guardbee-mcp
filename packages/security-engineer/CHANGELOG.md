# @guardbee/mcp-security-engineer

## 0.2.0

### Minor Changes

- [#298](https://github.com/GuardBee/guardbee-mcp/pull/298) [`21d5acd`](https://github.com/GuardBee/guardbee-mcp/commit/21d5acdf9a3088cca9dbe87348f14139d0d99c27) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - `detect_stack` also recognizes `vercel.json`, `netlify.toml`, `public/_headers`, Cloudflare worker deps, and Dockerfiles that reference nginx; Fly.io and Firebase Hosting show up as notes. The MCP server version now follows `package.json`.

## 0.1.1

### Patch Changes

- [#293](https://github.com/GuardBee/guardbee-mcp/pull/293) [`18c900b`](https://github.com/GuardBee/guardbee-mcp/commit/18c900b9f1ff848f7b94fcf3baf1b3e18efefdcb) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - security-engineer: the README now says that usage telemetry is off by default and how `GUARDBEE_TELEMETRY=1` turns it on, as the other packages do, and lists the variable under Configuration. Adds npm badges, a language switcher, and the missing Configuration and License sections to the Turkish README.

## 0.1.0

### Minor Changes

- [#285](https://github.com/GuardBee/guardbee-mcp/pull/285) [`89f77cc`](https://github.com/GuardBee/guardbee-mcp/commit/89f77cc3361a56fdf05d0bef1a759e916e41dd30) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - New MCP server: fix GuardBee AI Security Engineer findings in your own repository with your coding agent (Claude Code, Cursor, VS Code), then verify the fix on the live site. Tools: `list_assessments`, `get_assessment`, `detect_stack` (Next.js, Express, Nginx, Apache, Cloudflare from the repository's own files), `get_fix` (platform-specific fix, exact diff against a project Nginx/Apache config), `report_applied` and `verify_fix`. The server only reads and reports; edits are made by your agent with your approval. Requires a GuardBee API key with the `remediations.read` and `remediations.write` scopes.
