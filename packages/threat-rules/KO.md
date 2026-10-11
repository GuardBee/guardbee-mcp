# @guardbee/mcp-threat-rules

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | **🇰🇷 한국어** | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> 이 문서는 짧은 요약입니다. 전체 문서(영어)는 [README.md](README.md)를 참고하세요.

Agent Threat Rules(ATR)에 대한 GuardBee MCP 브리지입니다. 프롬프트 인젝션, 도구 포이즈닝, 컨텍스트 유출, MCP 공격을 위한 개방형 Sigma 스타일 탐지 표준으로 에이전트/MCP 이벤트를 평가합니다.

## 설치

```bash
npx -y @guardbee/mcp-threat-rules
```

Claude Desktop:

```json
{
  "mcpServers": {
    "threat-rules": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-threat-rules"
      ]
    }
  }
}
```

## MCP 도구

`evaluate_text`, `evaluate_file`, `evaluate_event`, `list_rules`, `rule_stats`, `explain_bridge`

각 도구의 자세한 설명은 [README.md](README.md)에 있습니다.

## CLI

```bash
npx @guardbee/mcp-threat-rules --help
```

> 이 패키지는 기본적으로 익명 사용 원격 측정(도구 이름과 짧은 매개변수만)을 전송합니다. `GUARDBEE_TELEMETRY=0`으로 끌 수 있습니다.

## 라이선스

MIT — [GuardBee](https://guardbee.ai)
