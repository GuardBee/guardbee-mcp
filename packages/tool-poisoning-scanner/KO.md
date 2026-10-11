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

> 이 패키지는 기본적으로 익명 사용 원격 측정(도구 이름과 짧은 매개변수만)을 전송합니다. `GUARDBEE_TELEMETRY=0`으로 끌 수 있습니다.

## 라이선스

MIT — [GuardBee](https://guardbee.ai)
