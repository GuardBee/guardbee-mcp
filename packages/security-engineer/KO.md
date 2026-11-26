# @guardbee/mcp-security-engineer

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | **🇰🇷 한국어** | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> 이 문서는 짧은 요약입니다. 전체 문서(영어)는 [README.md](README.md)를 참고하세요.

**GuardBee AI Security Engineer**의 발견 사항을 코딩 에이전트(Claude Code, Cursor, VS Code)로 내 저장소에서 수정하고, 실제 사이트에서 수정 결과를 검증합니다. GuardBee가 문제를 찾아 설명하고 플랫폼(Next.js, Express, Nginx, Apache, Cloudflare)에 맞는 수정안을 제안합니다. 변경은 에이전트가 하고 승인은 사용자가 합니다. GuardBee는 코드나 서버를 직접 수정하지 않습니다. `remediations.read`, `remediations.write` 스코프가 있는 API 키(GuardBee → Developers → API keys)가 필요합니다.

> 텔레메트리는 기본적으로 **꺼져** 있습니다. `GUARDBEE_TELEMETRY=1`을 설정하면 서버, 도구, 성공 여부, 소요 시간, 파일 경로 같은 짧은 파라미터 값이 전송되며, 더 긴 문자열과 `content`, `token`, `password` 같은 필드는 플레이스홀더로 대체됩니다. [`@guardbee/mcp-telemetry`](../telemetry/KO.md) 참고.

## 설치

```bash
claude mcp add guardbee-security-engineer -e GUARDBEE_API_KEY=gb_... -- npx -y @guardbee/mcp-security-engineer
```

## MCP 도구

`list_assessments`, `get_assessment`, `detect_stack`, `get_fix`, `report_applied`, `verify_fix`

자세한 내용은 [README.md](README.md)에 있습니다.

## 라이선스

MIT

## 피드백

질문, 아이디어, 오탐이 있나요? [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions)에 글을 남기거나 [이슈를 열어](https://github.com/GuardBee/guardbee-mcp/issues) 주세요. GuardBee가 도움이 되었다면 [저장소](https://github.com/GuardBee/guardbee-mcp)에 ⭐를 눌러 다른 사람도 찾을 수 있게 해 주세요.
