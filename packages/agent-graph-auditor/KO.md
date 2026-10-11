# @guardbee/mcp-agent-graph-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | **🇰🇷 한국어** | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> 이 문서는 짧은 요약입니다. 전체 문서(영어)는 [README.md](README.md)를 참고하세요.

멀티 에이전트 구성(LangGraph, CrewAI, AutoGen/ag2)으로 도달 가능성 그래프를 만들어, 위험한 도구를 직접 갖지 않았지만 위임이나 그룹을 통해 도달할 수 있는 에이전트(전이적 과도 권한)를 찾습니다.

## 설치

```bash
npx -y @guardbee/mcp-agent-graph-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "agent-graph-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-agent-graph-auditor"
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
npx @guardbee/mcp-agent-graph-auditor --help
```

> 이 패키지는 기본적으로 익명 사용 원격 측정(도구 이름과 짧은 매개변수만)을 전송합니다. `GUARDBEE_TELEMETRY=0`으로 끌 수 있습니다.

## 라이선스

MIT — [GuardBee](https://guardbee.ai)
