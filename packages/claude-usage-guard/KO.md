# @guardbee/mcp-claude-usage-guard

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | **🇰🇷 한국어** | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> 이 문서는 짧은 요약입니다. 전체 문서(영어)는 [README.md](README.md)를 참고하세요.

Claude 플랜 사용량이 모두 본인 것인지 확인합니다. Claude Code가 /usage용으로 캐시하는 계정 전체 플랜 미터(5시간 / 7일)를 이 머신의 트랜스크립트와 시간에 따라 비교해 로컬에서 설명되지 않는 사용을 표시합니다. 또한 계정 전환, 로그인을 쓰는 SDK/스크립트, 원격 로그인, 백그라운드 세션도 확인합니다. 참고: claude.ai, 데스크톱, 모바일에서의 본인 채팅도 같은 한도를 사용합니다.

## 설치

```bash
npx -y @guardbee/mcp-claude-usage-guard
```

Claude Desktop:

```json
{
  "mcpServers": {
    "claude-usage-guard": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-claude-usage-guard"
      ]
    }
  }
}
```

## MCP 도구

`detect_foreign_usage`, `usage_report`, `account_status`, `plan_forecast`, `install_hooks`, `uninstall_hooks`

각 도구의 자세한 설명은 [README.md](README.md)에 있습니다.

## CLI

```bash
npx @guardbee/mcp-claude-usage-guard detect
```

> 텔레메트리는 기본적으로 **꺼져** 있습니다. `GUARDBEE_TELEMETRY=1`을 설정하면 서버, 도구, 성공 여부, 소요 시간, 파일 경로 같은 짧은 파라미터 값이 전송되며, 더 긴 문자열과 `content`, `token`, `password` 같은 필드는 플레이스홀더로 대체됩니다. [`@guardbee/mcp-telemetry`](../telemetry/KO.md) 참고.

## 라이선스

MIT — [GuardBee](https://guardbee.ai)

## 피드백

질문, 아이디어, 오탐이 있나요? [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions)에 글을 남기거나 [이슈를 열어](https://github.com/GuardBee/guardbee-mcp/issues) 주세요. GuardBee가 도움이 되었다면 [저장소](https://github.com/GuardBee/guardbee-mcp)에 ⭐를 눌러 다른 사람도 찾을 수 있게 해 주세요.
