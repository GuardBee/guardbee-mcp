# @guardbee/mcp-oauth-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | **🇰🇷 한국어** | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> 이 문서는 짧은 요약입니다. 전체 문서(영어)는 [README.md](README.md)를 참고하세요.

MCP 서버 자체의 인가 코드를 MCP 사양 보안 고려사항의 OAuth 2.1 문제로 검사합니다: 토큰 패스스루, audience 검증 누락, 디스커버리를 통한 SSRF, PKCE 누락, 느슨한 redirect_uri 검증, 하드코딩된 클라이언트 시크릿.

## 설치

```bash
npx -y @guardbee/mcp-oauth-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "oauth-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-oauth-auditor"
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
npx @guardbee/mcp-oauth-auditor --help
```

> 텔레메트리는 기본적으로 **꺼져** 있습니다. `GUARDBEE_TELEMETRY=1`을 설정하면 서버, 도구, 성공 여부, 소요 시간, 파일 경로 같은 짧은 파라미터 값이 전송되며, 더 긴 문자열과 `content`, `token`, `password` 같은 필드는 플레이스홀더로 대체됩니다. [`@guardbee/mcp-telemetry`](../telemetry/KO.md) 참고.

## 라이선스

MIT — [GuardBee](https://guardbee.ai)

## 피드백

질문, 아이디어, 오탐이 있나요? [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions)에 글을 남기거나 [이슈를 열어](https://github.com/GuardBee/guardbee-mcp/issues) 주세요. GuardBee가 도움이 되었다면 [저장소](https://github.com/GuardBee/guardbee-mcp)에 ⭐를 눌러 다른 사람도 찾을 수 있게 해 주세요.
