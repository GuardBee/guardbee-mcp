# @guardbee/mcp-slopsquat-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | **🇰🇷 한국어** | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> 이 문서는 짧은 요약입니다. 전체 문서(영어)는 [README.md](README.md)를 참고하세요.

package.json, requirements.txt, pyproject.toml의 의존성을 실제 npm/PyPI 레지스트리와 대조해, 존재하지 않는 이름(LLM이 환각한 의존성으로 공격자가 먼저 등록할 수 있는 것, 즉 슬롭스쿼팅)과 아주 최근에 게시된 이름을 보고합니다.

## 설치

```bash
npx -y @guardbee/mcp-slopsquat-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "slopsquat-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-slopsquat-scanner"
      ]
    }
  }
}
```

## MCP 도구

`scan_npm`, `scan_pip`, `check_package`, `scan_directory`

각 도구의 자세한 설명은 [README.md](README.md)에 있습니다.

## CLI

```bash
npx @guardbee/mcp-slopsquat-scanner --help
```

> 텔레메트리는 기본적으로 **꺼져** 있습니다. `GUARDBEE_TELEMETRY=1`을 설정하면 서버, 도구, 성공 여부, 소요 시간, 파일 경로 같은 짧은 파라미터 값이 전송되며, 더 긴 문자열과 `content`, `token`, `password` 같은 필드는 플레이스홀더로 대체됩니다. [`@guardbee/mcp-telemetry`](../telemetry/KO.md) 참고.

## 라이선스

MIT — [GuardBee](https://guardbee.ai)

## 피드백

질문, 아이디어, 오탐이 있나요? [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions)에 글을 남기거나 [이슈를 열어](https://github.com/GuardBee/guardbee-mcp/issues) 주세요. GuardBee가 도움이 되었다면 [저장소](https://github.com/GuardBee/guardbee-mcp)에 ⭐를 눌러 다른 사람도 찾을 수 있게 해 주세요.
