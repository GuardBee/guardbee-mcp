# @guardbee/mcp-llm-redteam

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

Testet einen laufenden LLM-Endpoint oder Chatbot mit Canary-basierten Jailbreak-, Extraktions- und Verschleierungsproben darauf, ob bekannte Umgehungstechniken seine Guardrails aushebeln.

## Installation

```bash
npx -y @guardbee/mcp-llm-redteam
```

Claude Desktop:

```json
{
  "mcpServers": {
    "llm-redteam": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-llm-redteam"
      ]
    }
  }
}
```

## MCP-Tools

`list_probes`, `run_probe_suite`

Details zu jedem Tool stehen in [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-llm-redteam --help
```

> Dieses Paket sendet standardmäßig anonyme Nutzungstelemetrie (nur Tool-Name und kurze Parameter). Abschalten mit `GUARDBEE_TELEMETRY=0`.

## Lizenz

MIT — [GuardBee](https://guardbee.ai)
