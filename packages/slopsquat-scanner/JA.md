# @guardbee/mcp-slopsquat-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | **🇯🇵 日本語** | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> これは短い概要です。完全なドキュメント（英語）は [README.md](README.md) をご覧ください。

package.json・requirements.txt・pyproject.toml の依存関係を実際の npm/PyPI レジストリと照合し、存在しない名前（LLM が幻覚した依存関係で、攻撃者が先に登録しうるもの＝スロップスクワッティング）とごく最近公開された名前を報告します。

## インストール

```bash
npx -y @guardbee/mcp-slopsquat-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "slopsquat-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-slopsquat-scanner"
      ]
    }
  }
}
```

## MCP ツール

`scan_npm`, `scan_pip`, `check_package`, `scan_directory`

各ツールの詳細は [README.md](README.md) を参照してください。

## CLI

```bash
npx @guardbee/mcp-slopsquat-scanner --help
```

> このパッケージは既定で匿名の利用テレメトリ（ツール名と短いパラメータのみ）を送信します。`GUARDBEE_TELEMETRY=0` で無効にできます。

## ライセンス

MIT — [GuardBee](https://guardbee.ai)
