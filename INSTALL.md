# Install anywhere

Every way to run GuardBee's MCP security tools.

## The gateway (`@guardbee/mcp-security-proxy`)

| Where | How |
| --- | --- |
| **npm** (local MCP clients, stdio) | `npx -y @guardbee/mcp-security-proxy@^1 init --client cursor` moves an MCP client's servers behind the gateway ([README](packages/security-proxy/README.md)) |
| **Container** | `docker run -p 8787:8787 -e GUARDBEE_PROXY_KEY=… -v "$PWD/guardbee-proxy.yaml:/etc/guardbee/guardbee-proxy.yaml:ro" ghcr.io/guardbee/mcp-security-proxy:1` |
| **Kubernetes** | `helm install gateway ./charts/guardbee-gateway --set-file config=guardbee-proxy.yaml --set secret.values.GUARDBEE_PROXY_KEY=…` ([chart](charts/guardbee-gateway/README.md)) |

The image is multi-arch (amd64, arm64) and built from the npm package by [`image.yml`](.github/workflows/image.yml) after each release. It carries an SBOM and SLSA provenance, and is signed with cosign:

```bash
cosign verify ghcr.io/guardbee/mcp-security-proxy:1 \
  --certificate-identity-regexp '^https://github.com/GuardBee/guardbee-mcp/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## Coding agents' own tools (`guardbee-hook`)

GuardBee policy, taint and secret checks on the agent's shell, file and web tools, not only on MCP:

```bash
npm i -g @guardbee/mcp-security-proxy
guardbee-hook install --claude-code   # or --cursor, --codex, --gemini-cli, --windsurf   [--project]
```

| Agent | Hooks file | Events |
| --- | --- | --- |
| Claude Code | `~/.claude/settings.json` | PreToolUse, PostToolUse |
| Cursor | `~/.cursor/hooks.json` | beforeShellExecution, beforeMCPExecution, beforeReadFile, after… |
| Codex CLI | `~/.codex/hooks.json` | PreToolUse, PostToolUse. Codex asks you to trust new hooks under `/hooks`. |
| Gemini CLI | `~/.gemini/settings.json` | BeforeTool, AfterTool. `tools.enableHooks` and `hooks.enabled` are turned on. Gemini CLI has no "ask", so a call that needs approval is denied with the reason. |
| Windsurf | `~/.codeium/windsurf/hooks.json` | pre_run_command, pre_read_code, pre_write_code, pre_mcp_tool_use, post_… Windsurf hooks block with exit code 2 and cannot ask. |

## Scanners

| Where | How |
| --- | --- |
| **CLI** | `npx -y @guardbee/mcp-owasp-scan@latest scan .` (and each scanner on its own, e.g. `@guardbee/mcp-tool-poisoning-scanner`) |
| **MCP server** | every scanner is also an MCP server: `npx -y @guardbee/mcp-security-suite` serves them all |
| **GitHub Actions** | `uses: GuardBee/guardbee-mcp/.github/actions/mcp-security-scan@<commit sha>` with `path`, `fail-on` and `upload-sarif` (SARIF to code scanning) |
| **Fleet** | `mcp-config-auditor discover --upload` from Jamf, Intune or systemd ([FLEET.md](packages/mcp-config-auditor/FLEET.md)) |
| **IDE** | VS Code: [`guardbee-ai.guardbee-vscode`](https://marketplace.visualstudio.com/items?itemName=guardbee-ai.guardbee-vscode) (also on Open VSX) |
| **MCP registries** | the official MCP Registry (`io.github.GuardBee/*`), Smithery, Glama, LobeHub |

## Trust

- The [MCP Index](packages/mcp-index) grades the servers in the official registry: `mcp-config-auditor --grades` and `guardbee-proxy init --grades`.
- npm packages are published from CI with provenance (`npm view @guardbee/mcp-security-proxy --json | jq .dist.attestations`).
