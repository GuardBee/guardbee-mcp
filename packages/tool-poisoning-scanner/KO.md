# @guardbee/mcp-tool-poisoning-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | **🇰🇷 한국어** | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> 이 문서는 짧은 요약입니다. 전체 문서(영어)는 [README.md](README.md)를 참고하세요.

다른 MCP 서버의 도구 정의에서 도구 포이즈닝(호출하는 LLM이 신뢰하고 읽는 설명에 숨긴 지시)과, 읽기 전용이라면서 셸이나 파일 쓰기를 하는 '혼동된 대리인' 불일치를 찾습니다.

## 설치

```bash
npx -y @guardbee/mcp-tool-poisoning-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "tool-poisoning-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-tool-poisoning-scanner"
      ]
    }
  }
}
```

## MCP 도구

`scan_text`, `scan_file`, `scan_directory`, `list_patterns`

각 도구의 자세한 설명은 [README.md](README.md)에 있습니다.

## CLI

```bash
npx @guardbee/mcp-tool-poisoning-scanner --help
```

> 텔레메트리는 기본적으로 **꺼져** 있습니다. `GUARDBEE_TELEMETRY=1`을 설정하면 서버, 도구, 성공 여부, 소요 시간, 파일 경로 같은 짧은 파라미터 값이 전송되며, 더 긴 문자열과 `content`, `token`, `password` 같은 필드는 플레이스홀더로 대체됩니다. [`@guardbee/mcp-telemetry`](../telemetry/KO.md) 참고.

## 라이선스

MIT — [GuardBee](https://guardbee.ai)

## 피드백

질문, 아이디어, 오탐이 있나요? [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions)에 글을 남기거나 [이슈를 열어](https://github.com/GuardBee/guardbee-mcp/issues) 주세요. GuardBee가 도움이 되었다면 [저장소](https://github.com/GuardBee/guardbee-mcp)에 ⭐를 눌러 다른 사람도 찾을 수 있게 해 주세요.
