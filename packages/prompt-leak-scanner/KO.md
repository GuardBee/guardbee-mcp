# @guardbee/mcp-prompt-leak-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | **🇰🇷 한국어** | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> 이 문서는 짧은 요약입니다. 전체 문서(영어)는 [README.md](README.md)를 참고하세요.

MCP 서버이자 리버스 프록시로서, LLM으로 나가는 프롬프트 속 자격 증명과 개인정보(API 키, TC Kimlik No, 신용카드, IBAN)를 애플리케이션을 떠나기 전에 잡아냅니다.

## 설치

```bash
npx -y @guardbee/mcp-prompt-leak-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "prompt-leak-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-prompt-leak-scanner"
      ]
    }
  }
}
```

## MCP 도구

`scan_text`, `scan_messages`, `scan_file`, `scan_directory`, `list_patterns`

각 도구의 자세한 설명은 [README.md](README.md)에 있습니다.

## CLI

```bash
npx @guardbee/mcp-prompt-leak-scanner --help
```

> 이 패키지는 기본적으로 익명 사용 원격 측정(도구 이름과 짧은 매개변수만)을 전송합니다. `GUARDBEE_TELEMETRY=0`으로 끌 수 있습니다.

## 라이선스

MIT — [GuardBee](https://guardbee.ai)
