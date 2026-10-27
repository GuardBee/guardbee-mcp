# @guardbee/security-suite

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

[![npm version](https://img.shields.io/npm/v/@guardbee/security-suite.svg)](https://www.npmjs.com/package/@guardbee/security-suite)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

Alle GuardBee-MCP-Sicherheitstools mit einer Installation: ein MCP-Server mit den Tools der Pakete deiner Wahl und eine CLI, die jedes Paket ausführt. 29 Pakete, 124 MCP-Tools.

> Telemetrie ist standardmäßig **aus**. Mit `GUARDBEE_TELEMETRY=1` werden Server, Tool, Erfolg, Dauer und kurze Parameterwerte wie ein Dateipfad gesendet; längere Strings und Felder wie `content`, `token` oder `password` werden durch einen Platzhalter ersetzt. Siehe [`@guardbee/mcp-telemetry`](../telemetry/DE.md).

## Installation

```bash
npm install -g @guardbee/security-suite
```

## MCP-Tools

`guardbee serve` stellt standardmäßig die Gruppe **recommended** bereit (31 Tools): OWASP-MCP-Top-10-Scan in einem Durchlauf, Secrets, Prompt Injection, toxische Datenflüsse, MCP-Client-Konfigurationen und Dependency-CVEs. Andere wählst du mit `--tools=code,network` (Gruppen oder Paket-IDs) oder `--tools=all` (124 Tools). Toolnamen tragen das Paketpräfix: `secrets_scan_text`, `injection_scan_text`. `guardbee list` zeigt Pakete und Gruppen.

```json
{ "mcpServers": { "guardbee": { "command": "npx", "args": ["-y", "@guardbee/security-suite", "serve", "--tools=recommended"] } } }
```

## CLI

`guardbee <paket-id> <args>` startet die CLI dieses Pakets, z. B. `guardbee owasp-scan scan . --fail-on=high`.

## Lizenz

MIT — [GuardBee](https://guardbee.ai)

## Feedback

Fragen, Ideen oder ein Fehlalarm? Starte eine Diskussion in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) oder [öffne ein Issue](https://github.com/GuardBee/guardbee-mcp/issues). Wenn GuardBee dir hilft, hilft ein ⭐ für [das Repository](https://github.com/GuardBee/guardbee-mcp) anderen, es zu finden.
