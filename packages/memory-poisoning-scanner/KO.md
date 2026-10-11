# @guardbee/mcp-memory-poisoning-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | **🇰🇷 한국어** | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> 이 문서는 짧은 요약입니다. 전체 문서(영어)는 [README.md](README.md)를 참고하세요.

에이전트 코드에서 메모리 오염 위험을 찾습니다: 신뢰할 수 없는 입력이 영구·세션 간 메모리(MemGPT형 메모리나 장기 기억용 벡터 스토어)에 기록되었다가 나중에 신뢰된 컨텍스트로 다시 불려오는 곳.

## 설치

```bash
npx -y @guardbee/mcp-memory-poisoning-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "memory-poisoning-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-memory-poisoning-scanner"
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
npx @guardbee/mcp-memory-poisoning-scanner --help
```

> 이 패키지는 기본적으로 익명 사용 원격 측정(도구 이름과 짧은 매개변수만)을 전송합니다. `GUARDBEE_TELEMETRY=0`으로 끌 수 있습니다.

## 라이선스

MIT — [GuardBee](https://guardbee.ai)
