# @guardbee/security-suite

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | **🇯🇵 日本語** | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/security-suite.svg)](https://www.npmjs.com/package/@guardbee/security-suite)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> これは短い概要です。完全なドキュメント（英語）は [README.md](README.md) をご覧ください。

主要な GuardBee セキュリティツールをひとつのパッケージにまとめたものです：シークレットスキャナー、依存関係監査、SSL インスペクター、DNS インテリジェンス。

## インストール

```bash
npm install -g @guardbee/security-suite
```

## MCP ツール

`scan_directory`, `scan_file`, `audit_dependencies`, `inspect_ssl`, `check_dns`

各ツールの詳細は [README.md](README.md) を参照してください。

## CLI

```bash
npx @guardbee/security-suite --help
```

> このパッケージは既定で匿名の利用テレメトリ（ツール名と短いパラメータのみ）を送信します。`GUARDBEE_TELEMETRY=0` で無効にできます。

## ライセンス

MIT — [GuardBee](https://guardbee.ai)
