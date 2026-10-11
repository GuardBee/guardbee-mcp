# @guardbee/mcp-llm-redteam

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | **🇰🇷 한국어** | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> 이 문서는 짧은 요약입니다. 전체 문서(영어)는 [README.md](README.md)를 참고하세요.

운영 중인 LLM 엔드포인트나 챗봇에 카나리아 기반 탈옥·추출·난독화 프로브를 보내, 알려진 우회 기법으로 가드레일이 뚫리는지 테스트합니다.

## 설치

```bash
npx -y @guardbee/mcp-llm-redteam
```

Claude Desktop:

```json
{
  "mcpServers": {
    "llm-redteam": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-llm-redteam"
      ]
    }
  }
}
```

## MCP 도구

`list_probes`, `run_probe_suite`

각 도구의 자세한 설명은 [README.md](README.md)에 있습니다.

## CLI

```bash
npx @guardbee/mcp-llm-redteam --help
```

> 이 패키지는 기본적으로 익명 사용 원격 측정(도구 이름과 짧은 매개변수만)을 전송합니다. `GUARDBEE_TELEMETRY=0`으로 끌 수 있습니다.

## 라이선스

MIT — [GuardBee](https://guardbee.ai)
