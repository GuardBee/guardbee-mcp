# @guardbee/mcp-prompt-injection-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | **🇰🇷 한국어** | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> 이 문서는 짧은 요약입니다. 전체 문서(영어)는 [README.md](README.md)를 참고하세요.

문서, 스크래핑한 페이지, RAG 콘텐츠에서 간접 프롬프트 인젝션을 찾습니다: 지시 덮어쓰기, 위조된 채팅 템플릿 역할, 숨은 텍스트, AI를 직접 부르는 내용, 데이터 유출 시도.

## 설치

```bash
npx -y @guardbee/mcp-prompt-injection-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "prompt-injection-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-prompt-injection-scanner"
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
npx @guardbee/mcp-prompt-injection-scanner --help
```

> 이 패키지는 기본적으로 익명 사용 원격 측정(도구 이름과 짧은 매개변수만)을 전송합니다. `GUARDBEE_TELEMETRY=0`으로 끌 수 있습니다.

## 라이선스

MIT — [GuardBee](https://guardbee.ai)
