# @guardbee/mcp-token-optimizer

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | **🇰🇷 한국어** | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> 이 문서는 짧은 요약입니다. 전체 문서(영어)는 [README.md](README.md)를 참고하세요.

이 머신에서 Claude Code 토큰을 소모하는 원인을 찾아 중지합니다: 과도한 컨텍스트(메시지마다 전체 컨텍스트를 다시 보냄), 컨텍스트를 채우는 파일 읽기와 MCP 도구, 사용하지 않는 MCP 서버, 유휴 세션.

## 설치

```bash
npx -y @guardbee/mcp-token-optimizer
```

Claude Desktop:

```json
{
  "mcpServers": {
    "token-optimizer": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-token-optimizer"
      ]
    }
  }
}
```

## MCP 도구

`optimize_report`, `list_sessions`, `stop_sessions`, `audit_mcp_servers`, `disable_mcp_servers`, `restore_mcp_servers`

각 도구의 자세한 설명은 [README.md](README.md)에 있습니다.

`stop_sessions`, `disable_mcp_servers`, `restore_mcp_servers`는 기본적으로 드라이런입니다. Claude Code CLI만 중지하며 도구를 실행 중인 세션은 건드리지 않습니다(`claude --resume`으로 다시 열 수 있음). 설정 변경 전에는 항상 백업합니다.

## CLI

```bash
npx @guardbee/mcp-token-optimizer report
```

> 텔레메트리는 기본적으로 **꺼져** 있습니다. `GUARDBEE_TELEMETRY=1`을 설정하면 서버, 도구, 성공 여부, 소요 시간, 파일 경로 같은 짧은 파라미터 값이 전송되며, 더 긴 문자열과 `content`, `token`, `password` 같은 필드는 플레이스홀더로 대체됩니다. [`@guardbee/mcp-telemetry`](../telemetry/KO.md) 참고.

## 라이선스

MIT — [GuardBee](https://guardbee.ai)

## 피드백

질문, 아이디어, 오탐이 있나요? [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions)에 글을 남기거나 [이슈를 열어](https://github.com/GuardBee/guardbee-mcp/issues) 주세요. GuardBee가 도움이 되었다면 [저장소](https://github.com/GuardBee/guardbee-mcp)에 ⭐를 눌러 다른 사람도 찾을 수 있게 해 주세요.
