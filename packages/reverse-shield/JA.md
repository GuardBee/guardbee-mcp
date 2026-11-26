# @guardbee/mcp-reverse-shield

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | **🇯🇵 日本語** | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> これは短い概要です。完全なドキュメント（英語）は [README.md](README.md) をご覧ください。

**公開したアプリがリバースエンジニアに何を無償で渡してしまうか**を示す MCP サーバーです。リバースエンジニアリング MCP を使えば、エージェントはソースのないアプリをバイナリレベルまで解説できます。本パッケージはその防御側です。*自分の*ビルド成果物を指定すると、そうしたツール（あるいは jadx、ILSpy、Hopper、ブラウザの DevTools）が苦労なく得られるものを、それぞれの修正方法とともに報告します。対象は Web バンドルと本番サイト（ソースマップ、シークレット）、Electron（fuse、ASAR）、Android APK/AAB、iOS IPA、Unity、PyInstaller、Java、Flutter、ネイティブバイナリ（ELF、Mach-O、PE）、.NET です。`scan_url` 以外はすべてローカル・オフラインで動作し、結果には A〜F の評価が付きます。

> テレメトリはデフォルトで**無効**です。`GUARDBEE_TELEMETRY=1` を設定すると、サーバー、ツール、成否、所要時間、ファイルパスなどの短いパラメータ値が送信されます。長い文字列や `content`、`token`、`password` などのフィールドはプレースホルダーに置き換えられます。詳しくは [`@guardbee/mcp-telemetry`](../telemetry/JA.md) を参照してください。

## インストール

```json
{
  "mcpServers": {
    "guardbee-reverse-shield": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-reverse-shield"]
    }
  }
}
```

## MCP ツール

`scan_artifact`, `suggest_fixes`, `scan_url`, `list_checks`

詳細は [README.md](README.md) を参照してください。

## 使い方

```bash
npx @guardbee/mcp-reverse-shield scan ./dist --fail-on=high
npx @guardbee/mcp-reverse-shield scan ./app/build/outputs/apk/release/app-release.apk
npx @guardbee/mcp-reverse-shield scan https://app.example.com --format=sarif > reverse-shield.sarif
npx @guardbee/mcp-reverse-shield suggest . --format=patch | git apply
```

## 制限

難読化は名前だけで判定し、制御フローは分析しません。Web チェックは公開されたものしか見ないため、キーが公開されてよいもの（例：制限付きの Firebase Web キー）かどうかは判断できません。`suggest_fixes` は一般的な設定の書き方のみに対応します。適用前に diff を確認してください。

詳細は [README.md](README.md) を参照してください。

## ライセンス

MIT

## フィードバック

質問、アイデア、誤検知の報告は [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) か [issue](https://github.com/GuardBee/guardbee-mcp/issues) へどうぞ。GuardBee が役に立ったら、[リポジトリ](https://github.com/GuardBee/guardbee-mcp)への ⭐ が他の人の発見につながります。
