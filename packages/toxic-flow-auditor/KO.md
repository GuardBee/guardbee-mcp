# @guardbee/mcp-toxic-flow-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | **🇰🇷 한국어** | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> 이 문서는 짧은 요약입니다. 전체 문서(영어)는 [README.md](README.md)를 참고하세요.

MCP 도구 카탈로그 전체에서 유해 데이터 흐름(lethal trifecta)을 찾습니다: 신뢰할 수 없는 콘텐츠, 민감한 데이터, 외부 전송이나 파괴적 작업이 같은 서버에 함께 있는 조합.

## 설치

```bash
npx -y @guardbee/mcp-toxic-flow-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "toxic-flow-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-toxic-flow-auditor"
      ]
    }
  }
}
```

## MCP 도구

`audit_catalog`, `scan_source`, `scan_file`, `scan_directory`, `explain_trifecta`

각 도구의 자세한 설명은 [README.md](README.md)에 있습니다.

## CLI

```bash
npx @guardbee/mcp-toxic-flow-auditor --help
```

> 이 패키지는 기본적으로 익명 사용 원격 측정(도구 이름과 짧은 매개변수만)을 전송합니다. `GUARDBEE_TELEMETRY=0`으로 끌 수 있습니다.

## 라이선스

MIT — [GuardBee](https://guardbee.ai)
