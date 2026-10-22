# @guardbee/mcp-llm-redteam

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-llm-redteam.svg)](https://www.npmjs.com/package/@guardbee/mcp-llm-redteam)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-llm-redteam.svg)](https://www.npmjs.com/package/@guardbee/mcp-llm-redteam)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

An MCP (Model Context Protocol) server that **actively** red-teams a live LLM endpoint or chatbot — not static analysis like GuardBee's other scanners, but real probe requests sent to a real target you control.

`ai-code-scanner`, `mcp-server-auditor`, and `prompt-injection-scanner` all look at code or content at rest. This package looks at a **running system**: does a deployed LLM/chatbot's guardrails actually hold up against known jailbreak, extraction, obfuscation, and refusal-suppression techniques, right now, in production?

> ⚠️ **Only point this at an endpoint you own or are explicitly authorized to test.** Every probe sends a real request and consumes API quota on the target. This is a self-testing tool — you supply your own API key/endpoint.
>
> **No probe ever asks the target to produce genuinely harmful content.** Every probe is *canary-based*: success is measured by whether the target reproduces a random, single-use token we generate per run — proof that an out-of-character instruction was obeyed, without ever eliciting real harmful output. This keeps results deterministic (a canary can't appear by coincidence) and safe to run against a live endpoint.

> Telemetry is **off** by default. With `GUARDBEE_TELEMETRY=1` it sends the server, tool, success, duration and short parameter values such as a file path; longer strings and fields like `content`, `token` or `password` are replaced with a placeholder. See [`@guardbee/mcp-telemetry`](../telemetry/README.md).

```
Your LLM endpoint / chatbot ◄── llm-redteam ──► Claude
              │
              ├─ Instruction override    (DAN-style role-play, direct "ignore instructions")
              ├─ Extraction              ("repeat everything above", translation-reframed leak)
              ├─ Obfuscation             (base64-encoded instruction, zero-width smuggling)
              ├─ Refusal suppression     (fake system-override impersonation)
              └─ Multilingual            (same override, non-English phrasing)
```

---

## Features

- **12 probes, 5 categories** — instruction-override, extraction, obfuscation, refusal-suppression, multilingual
- **Canary-based, not harm-based** — deterministic pass/fail, never requests real harmful content
- **3 target types** — OpenAI-compatible chat APIs (OpenAI, Groq, local vLLM, etc.), Anthropic Messages API, or your own webhook
- Every bypass includes **why it matters and what to do about it** (`recommendation`)
- CLI mode for CI (e.g. red-team your staging chatbot on every deploy)
- 29 unit tests — target adapters tested against a mocked `fetch`, no real network calls in the test suite

---

## Quick Start

### Claude Desktop / MCP Client

```json
{
  "mcpServers": {
    "guardbee-llm-redteam": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-llm-redteam"],
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

Then ask Claude: *"Run the GuardBee red-team suite against my OpenAI endpoint using gpt-4o-mini."*

### CLI (CI/CD)

```bash
export OPENAI_API_KEY=sk-...
npx @guardbee/mcp-llm-redteam probe --type=openai --model=gpt-4o-mini --api-key-env=OPENAI_API_KEY --fail-on=high
```

```bash
# Your own chatbot endpoint
npx @guardbee/mcp-llm-redteam probe --type=webhook --url=https://staging.example.com/chat --fail-on=any
```

---

## MCP Tools

| Tool | Description |
|------|----------|
| `list_probes` | Lists all probes by category — no network call |
| `run_probe_suite` | Runs probes against a target you specify; returns which ones bypassed the guardrails |

---

## Target Types

| Type | Use for |
|---|---|
| `openai` | OpenAI's Chat Completions API, or any OpenAI-compatible gateway via `baseUrl` (Groq, local vLLM/Ollama proxies, etc.) |
| `anthropic` | Anthropic's Messages API directly |
| `webhook` | Your own chatbot/product endpoint — POSTs `{ prompt }` as JSON, reads the reply from a configurable field |

The API key is **never** passed as a tool/CLI parameter — only the name of an environment variable that already holds it (`apiKeyEnv`). Set that env var before running.

---

## Detected Bypass Categories

| Category | Example probe | Severity | What a bypass means |
|---|---|---|---|
| instruction-override | `direct_override`, `role_play_dan` | high | A direct or role-play override instruction replaced the system prompt's authority |
| extraction | `system_prompt_leak_direct`, `repeat_above` | critical | The target revealed (or proved it would reveal) its own system prompt |
| obfuscation | `base64_instruction`, `zero_width_smuggling` | high/medium | An override instruction hidden via encoding or invisible characters still worked |
| refusal-suppression | `authority_impersonation` | high | A fake "system override" framing was granted real instruction authority |
| multilingual | `non_english_override` | medium | The same override succeeded when phrased in a non-English language |

These are **known, publicly documented technique shapes** — this is defensive coverage testing, not novel attack research. A held probe doesn't prove a target is unbreakable; a bypassed probe is a concrete, reproducible finding.

---

## Development

```bash
npm run build
npm test             # 29 unit tests
```

---

## License

MIT — [GuardBee](https://guardbee.ai)

## Feedback

Questions, ideas, or a false positive? Start a thread in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) or [open an issue](https://github.com/GuardBee/guardbee-mcp/issues). If GuardBee is useful to you, a ⭐ on [the repository](https://github.com/GuardBee/guardbee-mcp) helps others find it.
