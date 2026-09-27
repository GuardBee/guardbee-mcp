# @guardbee/mcp-rug-pull-detector

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md)

An MCP (Model Context Protocol) server that connects **live** to another MCP server and detects an **MCP rug pull** — a server presenting one tool definition when you approve it, then silently serving a different one later.

Every other scanner in this monorepo reads source code or a config file once. This one is architecturally different: it's an MCP *client*. It spawns the target server (stdio) or opens a session with it (Streamable HTTP), calls the real `tools/list` RPC, and remembers what it saw — the same trust-on-first-use model an SSH client uses for host keys. A tool's description, input/output schema, or annotations changing between two calls to the exact same server is not something any static analysis of that server's source could ever catch, because the server may not have changed its source at all — it can decide server-side, at request time, what to tell which client.

> This package sends usage telemetry by default (tool name + short parameters, the target server's tool contents are never included — see [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Disable with `GUARDBEE_TELEMETRY=0`.

```
Claude ──► rug-pull-detector ──► (spawns / connects to) ──► Target MCP server
              │                                                  │
              │                                          tools/list (real RPC)
              ▼
         .guardbee/tool-baselines/<hash>.json
              │
    1st contact: baseline_server → store canonical hash per tool
    every later: check_server    → re-fetch, diff against stored hash
```

---

## The trust-on-first-use model

`baseline_server` connects once, fetches every tool's `{name, description, inputSchema, outputSchema, annotations}`, canonicalizes it (deep key-sorted JSON) and stores a SHA-256 hash plus the full snapshot — one JSON file per server under `.guardbee/tool-baselines/`.

Every `check_server` also runs the tool-poisoning catalog scan on the live `tools/list`, including the first time a server is seen and when no baseline is stored yet. A poisoned description does not wait for a second visit.

`check_server` connects again later — after a version bump, before every session, on a schedule, whatever cadence you choose — and re-fetches the same information. Any tool whose hash no longer matches is reported:

- **critical** — an *existing* tool's definition changed (`tool_definition_drift`). This is the rug pull itself. The finding says exactly which field changed (description / input schema / output schema / annotations) with the before/after description text, because `destructiveHint: true → false` is just as much a lie as a rewritten description — both change what a caller believes they're authorizing.
- **medium** — a *new* tool appeared that wasn't in the baseline (`tool_added`). Could be a legitimate release. Still worth a look — nothing stops a server introducing its dangerous tool only after the benign ones already earned trust.
- **low** — a *previously baselined* tool is no longer offered (`tool_removed`).

If no baseline exists yet, `check_server` captures one automatically and reports clean (pass `autoBaseline: false` / `--no-auto-baseline` to require an explicit `baseline_server` call first instead).

---

## Features

- **Real MCP client** — not a mock, not a source-code heuristic. Speaks the actual protocol over stdio or Streamable HTTP to whatever server you point it at.
- Canonical hashing covers name, description, input schema, output schema, **and** annotations (`readOnlyHint`, `destructiveHint`, ...) — a server can't dodge detection by only touching the fields a naive diff would skip.
- Three ways to specify a target: `--stdio="command arg1 arg2"`, `--url=<http-url>`, or `--config=<file> --server=<name>` (reads an `mcpServers`-style JSON config directly — the same shape as a Claude Desktop config)
- SARIF 2.1.0 output — CI/CD integration
- 28 tests: pure unit tests for hashing/diffing/storage, plus **real stdio process-spawning integration tests** against a fixture MCP server (not mocked) covering drift, addition, removal, and label isolation. End-to-end verified against `ai-code-scanner`'s own real, already-published MCP server — connected over genuine stdio JSON-RPC, baselined its 4 real tools, and confirmed a second check reports clean.

---

## Quick Start

### Claude Desktop / MCP Client

```json
{
  "mcpServers": {
    "guardbee-rug-pull-detector": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-rug-pull-detector"]
    }
  }
}
```

Then ask Claude to baseline a server you're about to add, and to re-check it periodically (e.g. "check this MCP server against its baseline before we use it today").

### CLI (CI/CD or scheduled check)

```bash
# First contact — do this only after you've reviewed the server's tools
npx @guardbee/mcp-rug-pull-detector baseline --config=claude_desktop_config.json --server=some-third-party-server

# Every later run — e.g. a scheduled job, or right before your app starts
npx @guardbee/mcp-rug-pull-detector check --config=claude_desktop_config.json --server=some-third-party-server --fail-on=critical
```

---

## MCP Tools

| Tool | Description |
|------|----------|
| `baseline_server` | Connects to a server and stores its current tools as the trusted baseline |
| `check_server` | Connects to a server and diffs its current tools against the stored baseline |
| `list_baselines` | Lists every server with a stored baseline |

---

## Configuration

No `guardbee.yml` section — the only persistent state is the baseline directory itself (`.guardbee/tool-baselines/` by default, override with `--baseline-dir`).

---

## Limitations (by design)

- **`--stdio` uses a simple whitespace split**, not shell-quote parsing — a command/argument containing spaces will break. Use `--config=<file> --server=<name>` (reading a real JSON config with a proper `args` array) for anything beyond a trivial command line.
- **Baseline identity is the `label` you give it** (or the command line / URL if you don't), not anything cryptographic about the server itself — renaming how you invoke a server starts a fresh baseline. Keep the label stable.
- This detects **drift in the tool list a server presents**, not malicious behavior inside a tool call that was always there. It's the rug-pull defense, not a replacement for `mcp-server-auditor` or `tool-poisoning-scanner` — run all three.
- Connecting to a stdio target means **spawning whatever command you give it** — the same thing every MCP client already does when you add a server to its config. Only point this at servers you intend to run.

---

## Development

```bash
npm run build
npm test             # 28 tests
```

---

## License

MIT — [GuardBee](https://guardbee.ai)
