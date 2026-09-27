# @guardbee/mcp-memory-poisoning-scanner

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md)

An MCP (Model Context Protocol) server that scans agent code for **memory poisoning** — untrusted input written into an agent's *persistent, cross-session* memory that later gets recalled and fed back to the model as trusted context, potentially in a completely unrelated future session.

`prompt-injection-scanner` catches an injection payload sitting in content the model reads once (a document, a scraped page). This package catches something structurally different: the code pattern that lets an injection payload become part of what the model treats as its own long-term knowledge — the same gap between reflected and stored XSS, applied to an agent's memory instead of a browser's DOM.

> This package sends usage telemetry by default (tool name + short parameters, scanned code is never included — see [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Disable with `GUARDBEE_TELEMETRY=0`.

```
Claude ──► memory-poisoning-scanner ──► Your agent's source
              │
              ├─ memory-write     (untrusted input persisted into archival/core memory or a vector KB)
              └─ memory-readback  (recalled memory fed into a system/assistant-role message or prompt)
```

---

## Why ordinary conversation memory is out of scope

A `ConversationBufferMemory` holding raw chat turns, or a plain `chatHistory.push({role: "user", content: userInput})`, is completely normal — that's just conversation history, not a vulnerability. This package deliberately does **not** flag that.

What it targets is narrower and higher-stakes: writes to *persistent* memory that outlives the current conversation — MemGPT-style archival memory (recalled across future, unrelated sessions) and core memory (re-injected into the system prompt on *every* turn by design), or a vector store used as a long-term knowledge base rather than per-conversation RAG context. If untrusted input lands there unsanitized, it doesn't just influence the current exchange — it becomes part of what the agent believes is true, for anyone, indefinitely, until someone happens to notice.

The second half of the risk is symmetric: a memory/vector retrieval result flowing directly into a `system`/`assistant`-role message or a prompt template is where a poisoned memory "cashes out" as an instruction the model obeys rather than data it merely reads.

---

## Features

- **5 memory-write patterns**: MemGPT `archival_memory_insert`/`core_memory_append`/`core_memory_replace` fed raw input, vector store `add_texts`/`add_documents`/`upsert` fed raw input, and a generic catch-all for custom-named long-term-memory/knowledge-base stores
- **3 memory-readback patterns**: archival/vector retrieval results flowing into a system/assistant-role message, or interpolated directly into a prompt template
- SARIF 2.1.0 output — CI/CD integration (GitHub Code Scanning, etc.)
- Config file support via `guardbee.yml`
- 17 unit tests — a positive and a negative (false-positive) scenario for every pattern, including an explicit check that ordinary conversation-buffer usage produces zero findings. End-to-end verified against a realistic planted-vulnerability fixture (caught both the write and the read-back) and the entire guardbee-mcp monorepo (386 files, zero false positives in production code)

---

## Quick Start

### Claude Desktop / MCP Client

```json
{
  "mcpServers": {
    "guardbee-memory-poisoning-scanner": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-memory-poisoning-scanner"]
    }
  }
}
```

### CLI (CI/CD)

```bash
npx @guardbee/mcp-memory-poisoning-scanner scan ./src --fail-on=high --format=sarif > results.sarif
```

---

## MCP Tools

| Tool | Description |
|------|----------|
| `scan_text` | Scans a code snippet |
| `scan_file` | Scans a single file |
| `scan_directory` | Recursively scans a directory |
| `list_patterns` | Lists all supported patterns by category |

---

## Detected Patterns

| Category | Pattern | Severity |
|---|---|---|
| memory-write | `archival_memory_insert_raw_input` | critical |
| memory-write | `core_memory_write_raw_input` (append/replace) | critical |
| memory-write | `vector_store_add_raw_input` | high |
| memory-write | `generic_named_memory_write_raw_input` | medium |
| memory-readback | `archival_memory_feeds_trusted_role` | critical |
| memory-readback | `vector_retrieval_feeds_trusted_role` | high |
| memory-readback | `memory_retrieval_feeds_prompt_template` | high |

---

## Configuration (`guardbee.yml`)

```yaml
memory-poisoning-scanner:
  fail-on: high       # any | critical | high | medium | none
  max-files: 5000
  exclude:
    - ".test.ts"
```

---

## Limitations (by design)

- **Heuristic, not taint tracking.** The write and read-back checks each look at one bounded location, not a proven data-flow path from a specific write to a specific later read. A finding means the *shape* of the risk is present in the code, not a mathematically confirmed exploit chain.
- **Pattern coverage is MemGPT-terminology and generic-JS-naming based.** A custom-built long-term memory system using entirely different function/variable names won't be recognized unless it happens to match the generic patterns (`*memory*`/`*knowledge_base*` naming, or a `vectorstore`-style API).
- This finds **code patterns that enable memory poisoning**, not an actual poisoned memory store at runtime — pair it with `prompt-injection-scanner` (for scanning what's actually stored) if you can inspect the memory contents directly.

---

## Development

```bash
npm run build
npm test             # 17 unit tests
```

---

## License

MIT — [GuardBee](https://guardbee.ai)
