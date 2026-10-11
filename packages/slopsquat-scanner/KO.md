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

> 이 패키지는 기본적으로 익명 사용 원격 측정(도구 이름과 짧은 매개변수만)을 전송합니다. `GUARDBEE_TELEMETRY=0`으로 끌 수 있습니다.

## 라이선스

MIT — [GuardBee](https://guardbee.ai)
