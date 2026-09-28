# @guardbee/mcp-unbounded-consumption-auditor

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md)

An MCP (Model Context Protocol) server that scans LLM/agent application code for **Unbounded Consumption** — OWASP LLM Top 10 2026's #6 category, also known as "denial of wallet": nothing stops the application from making unlimited billable calls.

> This package sends usage telemetry by default (tool name + short parameters, scanned code is never included — see [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Disable with `GUARDBEE_TELEMETRY=0`.

```
Claude ──► unbounded-consumption-auditor ──► your LLM/agent source
              │
              ├─ missing-token-limit    (no cap on how much the model can generate)
              ├─ missing-timeout        (a hand-rolled call to an LLM endpoint that can hang forever)
              ├─ unbounded-loop         (an agent/retry loop with no iteration cap)
              ├─ disabled-safety-limit  (a framework's own loop cap explicitly turned off)
              └─ missing-rate-limit     (an MCP tool making billable calls with no throttling)
```

OWASP's own write-up on this category gives a concrete cost example worth keeping in mind while reading findings: *"A research assistant agent without any recursion limit or call budget ended up making 500 tool calls with a simulated cost of $10... An agent with a call budget, a recursion depth limit and an agentic circuit breaker... completed one tool call, spending just $0.02."*

---

## Why these five checks specifically

Every pattern here was checked against real SDK source or real code before being written — not guessed from training-data assumption.

- **Missing token limit** targets `.chat.completions.create(...)` calls (OpenAI Python/JS) with neither `max_tokens` nor `max_completion_tokens` set. It's deliberately scoped to OpenAI-shaped calls only: Anthropic's own SDK makes `max_tokens` a **required** constructor argument — it raises before the request is even sent — so a matching check there would be 100% false positives. Reasoning models (o1+) silently ignore `max_tokens` and need `max_completion_tokens` instead, so the check only flags a call missing *both*.
- **Missing timeout** targets hand-rolled `requests`/`axios`/`fetch` calls whose own argument span mentions a known LLM endpoint (`api.openai.com`, `api.anthropic.com`, `/chat/completions`, `/v1/messages`). The official OpenAI/Anthropic SDKs already ship a bounded client-level default (openai-node: 600s) — flagging those would just be noise. `requests.post()`'s own Quickstart warns that an unset `timeout` can leave a program waiting indefinitely; axios and bare `fetch` have the same no-default-timeout shape.
- **Unbounded loop** covers two real shapes, both real-code-verified: a hand-rolled `while True:`/`while(true)` agent loop that dispatches `tool_calls` with nothing nearby suggesting an iteration cap (the exact shape quoted from a public 70-line-agent walkthrough), and a retry loop that catches an exception, calls straight back into an LLM, and `continue`s with no attempt counter (OWASP's own write-up calls this out by name: *"a failed step might be retried repeatedly"*). The retry-loop check is deliberately scoped to loops that actually call an LLM — an early version without that scoping flagged ordinary polling/retry code in a real open-source codebase during testing (see Development below).
- **Disabled safety limit** flags `max_iterations=None` (LangChain's `AgentExecutor`) and `max_turns=None` (openai-agents-python's `Runner.run`/`run_sync`) — both verified against real source before shipping. LangChain's `AgentExecutor` defaults `max_iterations` to 15, and its own `_should_continue()` only enforces the cap `if self.max_iterations is not None` — so `None` genuinely disables it. openai-agents-python's own issue tracker states plainly that `max_turns=None` disables the turn limit. **LangGraph's `recursion_limit` has no equivalent — it requires a concrete number — so no pattern is shipped for it**, rather than guessing at an unverified "disable" mechanism.
- **Missing rate limit** is the one heuristic pattern here, shipped at medium (not high/critical) severity on purpose: no MCP SDK (TypeScript or Python) provides a built-in per-caller throttling hook on tool registration, unlike the bounded defaults LangChain/LangGraph ship for iteration caps. Multiple independent 2026 write-ups describe the fix as a hand-rolled wrapper around `server.tool()`/`@mcp.tool()`, implying there's no framework default to fall back on. This check can't see a rate limiter enforced elsewhere (an API gateway, middleware in another file) — see Limitations.

**Relationship to `ai-code-scanner`:** that package already has a coarser `unbounded_agent_loop` pattern (any `while(true)`/`for(;;)` within 200 characters of a `.chat.completions.create`/`.messages.create` call, under its `excessive-agency` category) — it doesn't check whether the loop actually dispatches tool calls, and doesn't check for a nearby iteration-cap hint, so it would also flag a loop that's already properly bounded. This package's `unbounded_tool_calling_loop` is narrower and cost-specific: it requires an actual `tool_calls`/`toolCalls` reference (the real agentic-dispatch shape) and explicitly skips loops with a visible cap hint nearby.

---

## Features

- 7 patterns across 5 categories, each grounded in real SDK source, a real code walkthrough, or OWASP's own 2026 write-up — cited inline in the pattern comments
- 25 tests (positive + negative for every pattern, including the exact quoted real-world loop snippet the unbounded-loop checks are built from)
- SARIF 2.1.0 output — CI/CD integration (GitHub Code Scanning, etc.)
- End-to-end verified against a planted-vulnerability fixture (all 7 patterns caught, all 3 "safe counterpart" negatives correctly skipped) and against a real 3,414-file open-source codebase (`IBM/mcp-context-forge`) plus this monorepo's own 495 files — zero false positives in production code. Two real false positives *were* found and fixed during that verification, before shipping: an early, wider loop-body window let an unrelated `except`/`continue` elsewhere in the same file get mistaken for part of a nearby loop (fixed by requiring an LLM-call hint in the window and shrinking it), and a disabled `max_iterations=None` a few lines below a loop was briefly mistaken for a legitimate nearby iteration cap (fixed by stripping disabled-cap assignments before testing for a real one).

---

## Quick Start

### Claude Desktop / MCP Client

```json
{
  "mcpServers": {
    "guardbee-unbounded-consumption-auditor": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-unbounded-consumption-auditor"]
    }
  }
}
```

### CLI (CI/CD)

```bash
npx @guardbee/mcp-unbounded-consumption-auditor scan . --fail-on=high --format=sarif > results.sarif
```

---

## MCP Tools

| Tool | Description |
|------|----------|
| `scan_text` | Scan a code snippet for Unbounded Consumption anti-patterns |
| `scan_file` | Scan a single file |
| `scan_directory` | Recursively scan a directory |
| `list_patterns` | List every pattern this auditor detects, grouped by category |

---

## Detected Patterns

| Pattern | Category | Severity | Meaning |
|---|---|---|---|
| `openai_chat_completion_missing_max_tokens` | missing-token-limit | medium | An OpenAI chat completion call has neither `max_tokens` nor `max_completion_tokens` set |
| `raw_http_call_to_llm_endpoint_missing_timeout` | missing-timeout | medium | A hand-rolled HTTP call to a known LLM endpoint has no timeout/AbortSignal |
| `unbounded_tool_calling_loop` | unbounded-loop | medium | A hand-rolled `while(true)`/`while True:` loop dispatches `tool_calls` with no visible iteration cap |
| `unbounded_retry_loop` | unbounded-loop | medium | A retry loop around an LLM call catches an exception and continues with no attempt counter |
| `langchain_max_iterations_disabled` | disabled-safety-limit | high | LangChain's `AgentExecutor` `max_iterations` explicitly set to `None` |
| `openai_agents_max_turns_disabled` | disabled-safety-limit | high | openai-agents-python's `Runner` `max_turns` explicitly set to `None` |
| `mcp_tool_billable_call_no_rate_limit` | missing-rate-limit | medium | An MCP tool handler makes a billable LLM call with nothing suggesting per-caller rate limiting |

---

## Configuration (`guardbee.yml`)

```yaml
unbounded-consumption-auditor:
  fail-on: high         # any | critical | high | medium | low | none
  max-files: 5000
  exclude:
    - ".test.ts"
```

---

## Limitations (by design)

- **Bounded-window heuristics, not real control-flow analysis.** The loop checks look at a fixed character window after `while True:`/`while(true)`, not the actual loop body — a loop with an unusually long body, or one whose cap check lives outside that window, can be missed. Testing against real code found the reverse failure mode too (an unrelated `except`/`continue` further down getting mistaken for part of a nearby loop) and tightened the window accordingly; it's still a heuristic, not a parser.
- **The rate-limit check can't see enforcement elsewhere.** A tool handler with no rate-limiter in its own body might still be protected by an API gateway, middleware in another file, or a wrapper this scanner doesn't trace into — this check flags what's visible in the handler itself, nothing more.
- **No cross-function default detection.** If a project sets an output limit or timeout once, centrally, and every call site relies on that default implicitly (rather than passing it per-call), the per-call checks here will still flag each call site individually.
- **LangGraph's `recursion_limit` isn't checked.** Unlike LangChain and openai-agents-python, LangGraph's recursion limit requires a concrete number — there's no verified "set it to disable" mechanism, so no pattern is shipped for it rather than guessing at one.

---

## Development

```bash
npm run build
npm test             # 25 unit tests
```

---

## License

MIT — [GuardBee](https://guardbee.ai)
