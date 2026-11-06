# @guardbee/mcp-security-engineer

**🇬🇧 English** | [🇹🇷 Türkçe](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/security-engineer/TR.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-security-engineer.svg)](https://www.npmjs.com/package/@guardbee/mcp-security-engineer)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-security-engineer.svg)](https://www.npmjs.com/package/@guardbee/mcp-security-engineer)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/security-engineer/LICENSE)

Fix **GuardBee AI Security Engineer** findings in your own repository with your coding agent (Claude Code, Cursor, VS Code), then verify the fix on the live site.

GuardBee finds and explains the issue and proposes a fix for your platform. Your coding agent makes the change in your repository, and you approve it. GuardBee never edits your code or servers.

> Telemetry is **off** by default. With `GUARDBEE_TELEMETRY=1` it sends the server, tool, success, duration and short parameter values such as a file path; longer strings and fields like `content`, `token` or `password` are replaced with a placeholder. See [`@guardbee/mcp-telemetry`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/telemetry/README.md).

## Tools

| Tool | What it does |
|---|---|
| `list_assessments` | Recent AI Security Engineer assessments of your workspace |
| `get_assessment` | Actionable findings, highest priority first, with the platforms each can be fixed on |
| `detect_stack` | Detects Next.js, Express, Nginx, Apache or Cloudflare **from your repository's files**, and finds config files to diff against |
| `get_fix` | A reviewable fix for a finding. If you pass your Nginx or Apache config, you get an exact diff. |
| `report_applied` | Records that the fix was applied, with the commit SHA or PR URL as a reference |
| `verify_fix` | After you deploy, re-runs the check that reported the finding against the live site |

## Setup

1. In GuardBee, open **Developers → API keys** and create a key with the `remediations.read` and `remediations.write` scopes.
2. Add the server to your agent.

**Claude Code**

```bash
claude mcp add guardbee-security-engineer -e GUARDBEE_API_KEY=gb_... -- npx -y @guardbee/mcp-security-engineer
```

**Cursor / VS Code** (`mcp.json`)

```json
{
  "mcpServers": {
    "guardbee-security-engineer": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-security-engineer"],
      "env": { "GUARDBEE_API_KEY": "gb_..." }
    }
  }
}
```

## Example

> "Fix the top GuardBee findings of my latest assessment in this repo."

The agent:

1. Calls `list_assessments` and then `get_assessment`.
2. Calls `detect_stack`. For example, it finds Next.js and `deploy/nginx.conf`.
3. Calls `get_fix` for each finding, edits `next.config.js` or the Nginx config, and shows you the diff.
4. After you approve and commit, calls `report_applied` with the commit SHA.
5. After you deploy, calls `verify_fix`, and GuardBee confirms the issue is resolved.

## Configuration

| Variable | Default |
|---|---|
| `GUARDBEE_API_KEY` | required |
| `GUARDBEE_BASE_URL` | `https://app.guardbee.ai` |
| `GUARDBEE_TELEMETRY` | off; `1` turns on anonymous usage telemetry |

## Security

- The server only reads files inside the project root, and only the config file you name. Paths outside the root are rejected.
- File edits are made by your agent, and you approve them there.
- All actions are recorded in the GuardBee activity log, marked as coming from an MCP client.

## License

MIT
