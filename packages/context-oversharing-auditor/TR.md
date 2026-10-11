# @guardbee/mcp-context-oversharing-auditor

[🇬🇧 English](README.md) | **🇹🇷 Türkçe** | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

**OWASP MCP10:2025 — context oversharing** için kaynak tarayıcı. `toxic-flow-auditor` araç kataloğundaki lethal trifecta’yı notlar; bu paket oturum/bellek/sistem bağlamının gereğinden fazla paylaşılıp paylaşılmadığını bakar.

> Bu paket varsayılan olarak kullanım telemetrisi gönderir (araç adı + kısa parametreler; taranan kod asla dahil edilmez — bkz. [`@guardbee/mcp-telemetry`](../telemetry/README.md)). `GUARDBEE_TELEMETRY=0` ile kapatın.

## Ne yakalar?

| Pattern | Severity | Anlamı |
|---|---|---|
| `tool_dumps_full_conversation` | critical | Tool tam `messages` / konuşma geçmişini döndürür |
| `unscoped_memory_recall_tool` | high | `dump_memory` / `get_all_memories` tarzı tool’lar |
| `shared_global_session_store` | high | Kullanıcı anahtarsız global session Map/dict |
| `system_prompt_exposed_via_tool` | high | Tool `systemPrompt` / developer instructions döndürür |
| `cross_session_tool_result_reuse` | medium | Önceki tool sonuçları başka oturumun context’ine karışır |
| `vector_query_without_filter` | high | Tenant/user metadata filtresi olmayan vektör/RAG araması |

## Hızlı başlangıç

```json
{
  "mcpServers": {
    "guardbee-context-oversharing-auditor": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-context-oversharing-auditor"]
    }
  }
}
```

```bash
npx @guardbee/mcp-context-oversharing-auditor scan ./src --format=sarif
```
