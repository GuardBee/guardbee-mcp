# @guardbee/mcp-vector-store-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | **🇰🇷 한국어** | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> 이 문서는 짧은 요약입니다. 전체 문서(영어)는 [README.md](README.md)를 참고하세요.

벡터 데이터베이스 엔드포인트(Weaviate, Qdrant, Chroma, Elasticsearch/OpenSearch, Redis, Postgres/pgvector)를 점검해 임베딩과 RAG 데이터가 인증 없이 노출되어 있는지 확인합니다.

## 설치

```bash
npx -y @guardbee/mcp-vector-store-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "vector-store-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-vector-store-scanner"
      ]
    }
  }
}
```

## MCP 도구

`scan_endpoint`, `list_patterns`

각 도구의 자세한 설명은 [README.md](README.md)에 있습니다.

## CLI

```bash
npx @guardbee/mcp-vector-store-scanner --help
```

> 이 패키지는 기본적으로 익명 사용 원격 측정(도구 이름과 짧은 매개변수만)을 전송합니다. `GUARDBEE_TELEMETRY=0`으로 끌 수 있습니다.

## 라이선스

MIT — [GuardBee](https://guardbee.ai)
