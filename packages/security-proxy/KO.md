# @guardbee/mcp-security-proxy

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | **🇰🇷 한국어** | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-security-proxy.svg)](https://www.npmjs.com/package/@guardbee/mcp-security-proxy)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-security-proxy.svg)](https://www.npmjs.com/package/@guardbee/mcp-security-proxy)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> 이 문서는 짧은 요약입니다. 전체 문서(영어)는 [README.md](README.md)를 참고하세요.

MCP 보안 게이트웨이입니다. 여러 MCP 서버를 하나의 정책 뒤에 두고, 유해 데이터 흐름(lethal trifecta) 차단, 승인, 개인정보 마스킹, OIDC 사용자, 할당량, OpenTelemetry, 해시 체인 감사 로그를 제공합니다.

## 설치

```bash
npx -y @guardbee/mcp-security-proxy@^1 init --client claude-desktop
```

> 텔레메트리는 기본적으로 **꺼져** 있습니다. `GUARDBEE_TELEMETRY=1`을 설정하면 서버, 도구, 성공 여부, 소요 시간, 파일 경로 같은 짧은 파라미터 값이 전송되며, 더 긴 문자열과 `content`, `token`, `password` 같은 필드는 플레이스홀더로 대체됩니다. [`@guardbee/mcp-telemetry`](../telemetry/KO.md) 참고.

## 라이선스

MIT — [GuardBee](https://guardbee.ai)

## 피드백

질문, 아이디어, 오탐이 있나요? [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions)에 글을 남기거나 [이슈를 열어](https://github.com/GuardBee/guardbee-mcp/issues) 주세요. GuardBee가 도움이 되었다면 [저장소](https://github.com/GuardBee/guardbee-mcp)에 ⭐를 눌러 다른 사람도 찾을 수 있게 해 주세요.
