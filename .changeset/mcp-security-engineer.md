---
"@guardbee/mcp-security-engineer": minor
---

New MCP server: fix GuardBee AI Security Engineer findings in your own repository with your coding agent (Claude Code, Cursor, VS Code), then verify the fix on the live site. Tools: `list_assessments`, `get_assessment`, `detect_stack` (Next.js, Express, Nginx, Apache, Cloudflare from the repository's own files), `get_fix` (platform-specific fix, exact diff against a project Nginx/Apache config), `report_applied` and `verify_fix`. The server only reads and reports; edits are made by your agent with your approval. Requires a GuardBee API key with the `remediations.read` and `remediations.write` scopes.
