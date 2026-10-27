# @guardbee/security-suite

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | **🇰🇷 한국어** | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/security-suite.svg)](https://www.npmjs.com/package/@guardbee/security-suite)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> 짧은 요약입니다. 전체 문서(영어)는 [README.md](README.md)에 있습니다.

한 번 설치로 모든 GuardBee MCP 보안 도구를 사용할 수 있습니다. 선택한 패키지의 도구를 하나의 MCP 서버로 제공하고, CLI로 어떤 패키지든 실행할 수 있습니다. 30개 패키지, 127개 MCP 도구.

> 텔레메트리는 기본적으로 **꺼져** 있습니다. `GUARDBEE_TELEMETRY=1`을 설정하면 서버, 도구, 성공 여부, 소요 시간, 파일 경로 같은 짧은 파라미터 값이 전송되며, 더 긴 문자열과 `content`, `token`, `password` 같은 필드는 플레이스홀더로 대체됩니다. [`@guardbee/mcp-telemetry`](../telemetry/KO.md) 참고.

## 설치

```bash
npm install -g @guardbee/security-suite
```

## MCP 도구

`guardbee serve`는 기본적으로 **recommended** 그룹(31개 도구)을 제공합니다: OWASP MCP Top 10 일괄 스캔, 시크릿, 프롬프트 인젝션, 유해한 데이터 흐름, MCP 클라이언트 설정, 의존성 CVE. `--tools=code,network`로 그룹이나 패키지 ID를, `--tools=all`로 전체(127개)를 선택합니다. 도구 이름에는 패키지 접두사가 붙습니다(예: `secrets_scan_text`, `injection_scan_text`). `guardbee list`로 패키지와 그룹을 볼 수 있습니다.

```json
{ "mcpServers": { "guardbee": { "command": "npx", "args": ["-y", "@guardbee/security-suite", "serve", "--tools=recommended"] } } }
```

## CLI

`guardbee <패키지 ID> <인수>`는 해당 패키지의 CLI를 실행합니다. 예: `guardbee owasp-scan scan . --fail-on=high`.

## 라이선스

MIT — [GuardBee](https://guardbee.ai)

## 피드백

질문, 아이디어, 오탐이 있나요? [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions)에 글을 남기거나 [이슈를 열어](https://github.com/GuardBee/guardbee-mcp/issues) 주세요. GuardBee가 도움이 되었다면 [저장소](https://github.com/GuardBee/guardbee-mcp)에 ⭐를 눌러 다른 사람도 찾을 수 있게 해 주세요.
