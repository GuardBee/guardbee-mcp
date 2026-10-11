# @guardbee/mcp-dependency-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | **🇰🇷 한국어** | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-dependency-auditor.svg)](https://www.npmjs.com/package/@guardbee/mcp-dependency-auditor)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-dependency-auditor.svg)](https://www.npmjs.com/package/@guardbee/mcp-dependency-auditor)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> 이 문서는 짧은 요약입니다. 전체 문서(영어)는 [README.md](README.md)를 참고하세요.

npm과 pip 매니페스트를 OSV 데이터베이스와 대조해 알려진 CVE를 보고합니다. 단일 패키지 조회는 PyPI, crates.io, Maven, Go, RubyGems도 지원합니다.

## 설치

```bash
npx -y @guardbee/mcp-dependency-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "dependency-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-dependency-auditor"
      ]
    }
  }
}
```

## MCP 도구

`audit_npm`, `audit_pip`, `audit_package`, `audit_directory`

각 도구의 자세한 설명은 [README.md](README.md)에 있습니다.

## CLI

```bash
npx @guardbee/mcp-dependency-auditor --help
```

> 이 패키지는 기본적으로 익명 사용 원격 측정(도구 이름과 짧은 매개변수만)을 전송합니다. `GUARDBEE_TELEMETRY=0`으로 끌 수 있습니다.

## 라이선스

MIT — [GuardBee](https://guardbee.ai)
