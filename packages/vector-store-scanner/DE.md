# @guardbee/mcp-vector-store-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

Prüft Endpoints von Vektordatenbanken (Weaviate, Qdrant, Chroma, Elasticsearch/OpenSearch, Redis, Postgres/pgvector) darauf, ob Embeddings und RAG-Daten ohne Authentifizierung erreichbar sind.

## Installation

```bash
npx -y @guardbee/mcp-vector-store-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "vector-store-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-vector-store-scanner"
      ]
    }
  }
}
```

## MCP-Tools

`scan_endpoint`, `list_patterns`

Details zu jedem Tool stehen in [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-vector-store-scanner --help
```

> Dieses Paket sendet standardmäßig anonyme Nutzungstelemetrie (nur Tool-Name und kurze Parameter). Abschalten mit `GUARDBEE_TELEMETRY=0`.

## Lizenz

MIT — [GuardBee](https://guardbee.ai)
