# @guardbee/mcp-config-auditor

**🇬🇧 English** | [🇹🇷 Türkçe](README.md)

Bir ajanın hangi MCP sunucularını çalıştıracağına karar veren istemci config'ini tarar: Cursor `mcp.json`, Claude Desktop `claude_desktop_config.json`, Windsurf `mcp_config.json` ve VS Code `mcp.json`.

`mcp-server-auditor` sunucunun kaynağını okur. Bu paket ajanın çalıştıracağı sunucuları seçen dosyayı okur. O sunucuları başlatmaz ve config'i makine dışına göndermez.

## Kontroller

| Kalıp | Şiddet | OWASP | Anlamı |
|---|---|---|---|
| `unpinned_package` | high | MCP04:2025 | `npx`, `uvx`, `pnpm`, `yarn`, `bunx` veya `pipx` sürüm sabitlemesi olmayan bir paket çalıştırıyor |
| `typosquat_package` | critical | MCP04:2025 | Paket adı bilinen bir MCP sunucu paketine bir karakter uzak |
| `secret_in_env` | critical | MCP01:2025 | Ortam bloğunda credential |
| `secret_in_args` | critical | MCP01:2025 | Komut satırında token |
| `auto_approve_wildcard` | critical | MCP02:2025 | `autoApprove` / `alwaysAllow` değeri `*` veya `true` |
| `cleartext_remote` | high | MCP07:2025 | Loopback olmayan `http://` adresi |
| `unauthenticated_remote` | high/medium | MCP07:2025 | Kimlik doğrulaması olmayan uzak adres |
| `cross_server_tool_shadow` | high | MCP03:2025 | Aynı tool adı iki sunucuda |
| `confusable_tool_name` | critical | MCP03:2025 | Sunucular arasında homoglyph veya tek karakterlik tool adı |
| `cross_server_tool_redirect` | high | MCP03:2025 | Bir açıklama modeli başka sunucunun tool'una yönlendiriyor |

`localhost`, `127.0.0.1` ve `::1` uzak bulgu değildir. `${API_KEY}` ve `changeme` secret değildir. Secret eşleşmeleri maskelenir.

## Hızlı başlangıç

```bash
npx @guardbee/mcp-config-auditor scan .cursor/mcp.json --fail-on=high --format=sarif > results.sarif
npx @guardbee/mcp-config-auditor inventory ./tool-inventory.json
```

Dizin taraması yalnızca `mcp.json`, `mcp_config.json` ve `claude_desktop_config.json` açar. Gölgeleme kontrolü tool envanteri ister, çünkü istemci config'i tool listesi içermez.
