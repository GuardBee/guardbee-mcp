---
"@guardbee/mcp-config-auditor": minor
---

Fleet-wide shadow MCP inventory:

- `discover --allowlist-from-dashboard` checks every machine against the organization allowlist managed in the GuardBee dashboard (merged with `--allowlist`).
- `--grades` adds MCP Index grades to the uploaded inventory.
- `fetchDashboardAllowlist`, `allowlistUrlFor` and `inventoryKey` are exported.
- FLEET.md has Jamf, Intune, systemd and CI recipes.
