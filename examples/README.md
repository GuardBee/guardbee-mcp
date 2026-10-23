# Examples

Copy, adjust the paths and server names, and go.

## Demo (`demo/`)

An agent calls a stand-in CRM MCP server through the published proxy: personal data in a record is masked, a ticket carrying a prompt injection is blocked, and an e-mail after reading untrusted and sensitive content is refused as a lethal trifecta. `cd examples/demo && npm install && npm start`. [`demo.tape`](demo/demo.tape) records the README's GIF with [vhs](https://github.com/charmbracelet/vhs).

## Proxy policies (`proxy/`)

Every file here is checked by the proxy's tests, so it stays valid. Check yours with `npx -y @guardbee/mcp-security-proxy@^1 validate --config <file>`.

| File | For |
|---|---|
| [`minimal.yaml`](proxy/minimal.yaml) | Two MCP servers behind one policy with the defaults: injection scan, PII and secret masking, tool-poisoning scan, lethal-trifecta block, audit log |
| [`kvkk.yaml`](proxy/kvkk.yaml) | Personal data under KVKK/GDPR: `KVKK_SENSITIVE` preset, tokenized values, masked JSON fields, approval before egress, optional name detection |
| [`coding-agent.yaml`](proxy/coding-agent.yaml) | Claude Code or Cursor with GitHub, fetch and the filesystem: hidden tools, approvals for destructive calls and PRs, anomaly limits; also used by `guardbee-hook` for the agent's own shell and file tools |
| [`llm-gateway.yaml`](proxy/llm-gateway.yaml) | The proxy in front of the OpenAI and Anthropic APIs: gateway keys, routes, budgets, masked prompts and answers |
| [`remote-upstreams.yaml`](proxy/remote-upstreams.yaml) | Remote Streamable HTTP servers with network egress rules: host allowlist, private addresses refused for a public server, cloud metadata always refused |

The fastest start is `npx -y @guardbee/mcp-security-proxy@^1 init --client claude-desktop` (or `cursor`, `claude-code`): it moves your existing servers behind the proxy and backs up the client config.

## MCP client configs (`clients/`)

| File | Goes to |
|---|---|
| [`claude-desktop.json`](clients/claude-desktop.json) | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), `%APPDATA%\Claude\claude_desktop_config.json` (Windows) |
| [`claude-code.mcp.json`](clients/claude-code.mcp.json) | `.mcp.json` in your project: the proxy plus the scanner suite |
| [`cursor.mcp.json`](clients/cursor.mcp.json) | `.cursor/mcp.json` in your project, or `~/.cursor/mcp.json` |
| [`vscode.mcp.json`](clients/vscode.mcp.json) | `.vscode/mcp.json` in your project |

For Claude Code and Cursor's built-in tools (shell, file reads, web fetch), add the hooks: `guardbee-hook install --claude-code` or `--cursor` (from `npm i -g @guardbee/mcp-security-proxy`).

## CI (`ci/`)

| File | Runs |
|---|---|
| [`github-actions.yml`](ci/github-actions.yml) | OWASP MCP Top 10 scan, secrets in git history, dependency CVEs; SARIF to GitHub code scanning |
| [`gitlab-ci.yml`](ci/gitlab-ci.yml) | The same three checks on merge requests and the default branch |
