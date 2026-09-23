# @guardbee/mcp-agent-graph-auditor

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md)

An MCP (Model Context Protocol) server that builds a reachability graph across a multi-agent orchestration and finds **transitive excessive agency** — an agent that was never directly given a dangerous tool, but can still reach one through another agent it's allowed to delegate to.

`mcp-server-auditor` catches an MCP server whose own tool grants shell/eval/SQL access directly. `ai-code-scanner` catches a single agent's tool list containing `execute_command`. Both of those are **one hop**: agent → tool. Multi-agent frameworks add a second kind of edge — delegation, group chat, function-execution routing — and a "safe-looking" agent with only a `web_search` tool can become dangerous the moment it's allowed to hand work off to a coworker that holds a shell tool. That two-hop path is invisible to a scanner that only looks at one agent's own tool list at a time.

> This package sends usage telemetry by default (tool name + short parameters, scanned source is never included — see [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Disable with `GUARDBEE_TELEMETRY=0`.

```
Claude ──► agent-graph-auditor ──► Your multi-agent Python source
              │
              ├─ LangGraph   (add_node/add_edge — structural, read directly from the graph API)
              ├─ CrewAI      (Agent/tools/allow_delegation + Crew membership — heuristic)
              └─ AutoGen/ag2 (GroupChat membership, code_execution_config, register_function — heuristic)
```

---

## How the graph is built

1. **Extract.** Framework-specific regex extractors pull agent/tool nodes and relationship edges out of the source: `has_tool` (an agent's own toolset), `delegates_to` (CrewAI `allow_delegation`, LangGraph `add_edge`), `group_member` (AutoGen `GroupChat` co-membership — any member's output can be routed to any other by the manager), `executes_via` (AutoGen `register_function`'s caller/executor split).
2. **Classify.** Every tool node is checked against a name-based capability catalog (code execution, process execution, filesystem write, network, credentials access) — the same kind of heuristic `ai-code-scanner`'s excessive-agency pattern uses, just applied to a graph of tools instead of one server's tool list.
3. **Reach.** A breadth-first search runs from every agent node. A capability tool reached via a straight `has_tool` edge is a **direct** finding (still reported — useful even without a second agent in the picture). A capability tool reached only after crossing at least one `delegates_to`/`group_member`/`executes_via` edge is **transitive** — the finding this package exists for — and is always reported as critical, regardless of the tool's own base severity, because the agent holding it was never audited for it directly.

LangGraph is the most reliable target: `add_node`/`add_edge` calls **are** the orchestration graph in the source, no inference needed. CrewAI and AutoGen require inferring delegation from framework semantics (`allow_delegation`, `GroupChat` membership) rather than an explicit edge in the code, so treat those as heuristic — see Limitations below.

---

## Features

- **3 frameworks**: LangGraph (structural), CrewAI (heuristic), AutoGen/ag2 (heuristic)
- **7 capability rules** across 5 categories (code-execution, process-execution, filesystem-write, network, credentials-access)
- Distinguishes **direct** (single-agent) from **transitive** (delegation-crossing) excessive agency — the transitive case is what no single-agent scanner in this monorepo catches
- Multi-hop aware — a 3+ agent delegation chain is found the same way a 2-agent one is
- SARIF 2.1.0 output — CI/CD integration (GitHub Code Scanning, etc.)
- Config file support via `guardbee.yml`
- 31 unit tests, plus end-to-end verification against realistic fixtures for all three frameworks

---

## Quick Start

### Claude Desktop / MCP Client

```json
{
  "mcpServers": {
    "guardbee-agent-graph-auditor": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-agent-graph-auditor"]
    }
  }
}
```

### CLI (CI/CD)

```bash
npx @guardbee/mcp-agent-graph-auditor scan ./agents --fail-on=high --format=sarif > results.sarif
```

---

## MCP Tools

| Tool | Description |
|------|----------|
| `scan_text` | Scans a Python snippet |
| `scan_file` | Scans a single `.py` file |
| `scan_directory` | Recursively scans a directory of `.py` files |
| `list_patterns` | Lists the dangerous-capability catalog by category |

---

## Example

```python
researcher = Agent(role="Researcher", tools=[web_search_tool], allow_delegation=True)
ops = Agent(role="Ops Engineer", tools=[shell_tool], allow_delegation=False)
writer = Agent(role="Writer", tools=[], allow_delegation=False)
crew = Crew(agents=[researcher, ops, writer], tasks=[])
```

`researcher` never holds `shell_tool` — but `allow_delegation=True` plus co-membership in the same `Crew` as `ops` means it can hand work off to an agent that does. This scanner reports:

```
🔴 CRITICAL  Transitive excessive agency: reaches shell_tool
   Path: Researcher → Ops Engineer → shell_tool

🔴 CRITICAL  Direct excessive agency: reaches shell_tool
   Path: Ops Engineer → shell_tool
```

`writer` — no tools, no delegation — gets no finding at all.

---

## Configuration (`guardbee.yml`)

```yaml
agent-graph-auditor:
  fail-on: high       # any | critical | high | medium | none
  max-files: 2000
  exclude:
    - "**/*.test.py"
```

---

## Limitations (by design)

- **Single-file scope.** Each file's graph is extracted independently — Python variable references don't resolve across files. A `Crew(agents=[researcher, ops])` call will only connect to `Agent(...)` definitions found in the *same file*, even when scanning a whole directory.
- **CrewAI/AutoGen extraction is heuristic**, not a real Python parser — constructor bodies are captured with a bounded text window rather than exact paren-matching (the same tradeoff `ai-code-scanner`'s pattern-window matching makes), and it doesn't track reassignment, conditional agent construction, or dynamically built tool lists.
- **AutoGen's `speaker_selection_method`** isn't modeled — `GroupChat` co-membership is always treated as a bidirectional reachability edge, which is the conservative (over-inclusive, not under-inclusive) assumption.
- **Capability classification is name-based.** A tool named `search_tool` that secretly shells out internally won't be flagged; a tool named `shell_tool_disabled` will be. Review findings; don't take them as ground truth.
- Only Python source is scanned in v1 — LangChain/LangGraph's JS/TS API isn't covered yet.

---

## Development

```bash
npm run build
npm test             # 31 unit tests
```

---

## License

MIT — [GuardBee](https://guardbee.ai)
