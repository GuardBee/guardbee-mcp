# @guardbee/mcp-security-engineer

## 0.1.0

### Minor Changes

- [#285](https://github.com/GuardBee/guardbee-mcp/pull/285) [`89f77cc`](https://github.com/GuardBee/guardbee-mcp/commit/89f77cc3361a56fdf05d0bef1a759e916e41dd30) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - New MCP server: fix GuardBee AI Security Engineer findings in your own repository with your coding agent (Claude Code, Cursor, VS Code), then verify the fix on the live site. Tools: `list_assessments`, `get_assessment`, `detect_stack` (Next.js, Express, Nginx, Apache, Cloudflare from the repository's own files), `get_fix` (platform-specific fix, exact diff against a project Nginx/Apache config), `report_applied` and `verify_fix`. The server only reads and reports; edits are made by your agent with your approval. Requires a GuardBee API key with the `remediations.read` and `remediations.write` scopes.
