# @guardbee/mcp-elicitation-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | **🇰🇷 한국어** | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> 이 문서는 짧은 요약입니다. 전체 문서(영어)는 [README.md](README.md)를 참고하세요.

MCP 서버 코드에서 위험한 elicitation 패턴을 찾습니다: 폼으로 시크릿 요청, URL 모드가 제3자 인증 엔드포인트를 직접 가리킴, URL에 자격 증명이나 개인정보 포함.

## 설치

```bash
npx -y @guardbee/mcp-elicitation-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "elicitation-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-elicitation-auditor"
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
npx @guardbee/mcp-elicitation-auditor --help
```

> 이 패키지는 기본적으로 익명 사용 원격 측정(도구 이름과 짧은 매개변수만)을 전송합니다. `GUARDBEE_TELEMETRY=0`으로 끌 수 있습니다.

## 라이선스

MIT — [GuardBee](https://guardbee.ai)
