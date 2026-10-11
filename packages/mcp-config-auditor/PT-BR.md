# @guardbee/mcp-config-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | **🇧🇷 Português** | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> Este é um resumo curto. A documentação completa (em inglês) está em [README.md](README.md).

Audita configurações de clientes MCP instaladas (Cursor, Claude Desktop, Windsurf, VS Code) e arquivos SKILL.md de agentes: pacotes sem versão fixa, segredos, aprovação automática com curinga, remotos sem autenticação, typosquats e Shadow MCP (OWASP MCP09) contra a allowlist da organização.

## Instalação

```bash
npx -y @guardbee/mcp-config-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "mcp-config-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-config-auditor"
      ]
    }
  }
}
```

## Ferramentas MCP

`scan_config_text`, `scan_file`, `scan_skill_text`, `scan_directory`, `scan_inventory`, `discover_shadow_mcp`, `list_host_config_paths`, `list_patterns`

Os detalhes de cada ferramenta estão em [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-config-auditor --help
```

## Licença

MIT — [GuardBee](https://guardbee.ai)
