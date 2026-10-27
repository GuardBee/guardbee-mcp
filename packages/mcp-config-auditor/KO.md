# @guardbee/mcp-config-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | **🇰🇷 한국어** | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> 이 문서는 짧은 요약입니다. 전체 문서(영어)는 [README.md](README.md)를 참고하세요.

설치된 MCP 클라이언트 설정(Cursor, Claude Desktop, Windsurf, VS Code)과 에이전트 SKILL.md를 감사합니다: 고정되지 않은 패키지, 시크릿, 와일드카드 자동 승인, 인증 없는 원격 서버, 타이포스쿼팅, 조직 허용 목록 대비 Shadow MCP(OWASP MCP09).

## 설치

```bash
npx -y @guardbee/mcp-config-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "mcp-config-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-config-auditor"
      ]
    }
  }
}
```

## MCP 도구

`scan_config_text`, `scan_file`, `scan_skill_text`, `scan_directory`, `scan_inventory`, `discover_shadow_mcp`, `list_host_config_paths`, `list_patterns`

각 도구의 자세한 설명은 [README.md](README.md)에 있습니다.

## CLI

```bash
npx @guardbee/mcp-config-auditor --help
```

## 라이선스

MIT — [GuardBee](https://guardbee.ai)

## 피드백

질문, 아이디어, 오탐이 있나요? [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions)에 글을 남기거나 [이슈를 열어](https://github.com/GuardBee/guardbee-mcp/issues) 주세요. GuardBee가 도움이 되었다면 [저장소](https://github.com/GuardBee/guardbee-mcp)에 ⭐를 눌러 다른 사람도 찾을 수 있게 해 주세요.
