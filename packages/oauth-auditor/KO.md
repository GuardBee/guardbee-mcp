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

> 이 패키지는 기본적으로 익명 사용 원격 측정(도구 이름과 짧은 매개변수만)을 전송합니다. `GUARDBEE_TELEMETRY=0`으로 끌 수 있습니다.

## 라이선스

MIT — [GuardBee](https://guardbee.ai)
