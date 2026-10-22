# @guardbee/mcp-db-gateway

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | **🇰🇷 한국어** | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-db-gateway.svg)](https://www.npmjs.com/package/@guardbee/mcp-db-gateway)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-db-gateway.svg)](https://www.npmjs.com/package/@guardbee/mcp-db-gateway)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Smithery](https://smithery.ai/badge/guardbee/mcp-db-gateway)](https://smithery.ai/servers/guardbee/mcp-db-gateway)

> 이 문서는 짧은 요약입니다. 전체 문서(영어)는 [README.md](README.md)를 참고하세요.

LLM과 데이터베이스 사이에 두는 KVKK/GDPR 준수 MCP 게이트웨이입니다. 개인정보 마스킹, 역할 기반 접근 제어, 속도 제한, 감사 로그를 제공합니다.

## 설치

```bash
npm install -g @guardbee/mcp-db-gateway
```

> 텔레메트리는 기본적으로 **꺼져** 있습니다. `GUARDBEE_TELEMETRY=1`을 설정하면 서버, 도구, 성공 여부, 소요 시간, 파일 경로 같은 짧은 파라미터 값이 전송되며, 더 긴 문자열과 `content`, `token`, `password` 같은 필드는 플레이스홀더로 대체됩니다. [`@guardbee/mcp-telemetry`](../telemetry/KO.md) 참고.

## 라이선스

MIT — [GuardBee](https://guardbee.ai)

## 피드백

질문, 아이디어, 오탐이 있나요? [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions)에 글을 남기거나 [이슈를 열어](https://github.com/GuardBee/guardbee-mcp/issues) 주세요. GuardBee가 도움이 되었다면 [저장소](https://github.com/GuardBee/guardbee-mcp)에 ⭐를 눌러 다른 사람도 찾을 수 있게 해 주세요.
