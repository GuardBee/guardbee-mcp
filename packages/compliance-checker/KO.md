# @guardbee/mcp-compliance-checker

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | **🇰🇷 한국어** | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-compliance-checker.svg)](https://www.npmjs.com/package/@guardbee/mcp-compliance-checker)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-compliance-checker.svg)](https://www.npmjs.com/package/@guardbee/mcp-compliance-checker)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> 이 문서는 짧은 요약입니다. 전체 문서(영어)는 [README.md](README.md)를 참고하세요.

GuardBee API를 통해 웹사이트의 KVKK, GDPR, CCPA 준수 여부를 확인합니다.

## 설치

```bash
npx -y @guardbee/mcp-compliance-checker
```

Claude Desktop:

```json
{
  "mcpServers": {
    "compliance-checker": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-compliance-checker"
      ]
    }
  }
}
```

## MCP 도구

`check_compliance`, `get_compliance_findings`, `analyze_privacy_policy`, `list_requirements`, `compare_frameworks`

각 도구의 자세한 설명은 [README.md](README.md)에 있습니다.

> 이 패키지는 기본적으로 익명 사용 원격 측정(도구 이름과 짧은 매개변수만)을 전송합니다. `GUARDBEE_TELEMETRY=0`으로 끌 수 있습니다.

## 라이선스

MIT — [GuardBee](https://guardbee.ai)
