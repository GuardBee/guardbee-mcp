# @guardbee/mcp-vector-store-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文** | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

一个 MCP（Model Context Protocol）服务器，用于探测向量数据库（或具备向量索引能力的）端点是否存在**未认证暴露**——与反复出现的开放 Elasticsearch/MongoDB/Redis 实例泄露数据事件背后同一类错误配置，现在对准 RAG 时代技术栈：Weaviate、Qdrant、Chroma、Elasticsearch/OpenSearch、Redis 与 Postgres/pgvector。

每个 RAG 流水线的嵌入都存在某处。若该向量存储在网络上无需认证即可到达，任何找到它的人都可以读取（且常常写入）你的检索流水线曾获得的每一份文档——包括进入分块的任何敏感内容。

> 本包默认发送使用遥测（工具名 + 较短的参数，绝不包含被探测主机/响应内容——见 [`@guardbee/mcp-telemetry`](../telemetry/README.md)）。设置 `GUARDBEE_TELEMETRY=0` 即可关闭。

```
Claude ──► vector-store-scanner ──► Your vector-store endpoint
              │
              ├─ weaviate / qdrant / chroma / elasticsearch  (HTTP fingerprint)
              │     info ──► schema/collections ──► actual stored data
              ├─ redis        (raw RESP: PING, no AUTH sent)
              └─ postgres     (raw wire protocol: SSLRequest + StartupMessage, no password sent)
```

---

## 如何升级探测

每个基于 HTTP 的探测不会停在“这东西是否在线”——它按攻击者会走的同一路径、按影响递增顺序推进，并只报告实际成功的内容：

1. **实例信息**（medium）— 无需认证即可读取版本/构建详情。单独影响低，但确认服务已暴露并有助于指纹识别已知 CVE。
2. **Schema / collection 列表**（high）— 无需认证即可读取类或 collection 名称。甚至在读取任何真实数据之前就暴露你的数据模型。
3. **实际存储数据**（critical）— 无需认证就返回真实的 object/point/document。这才是真正重要的发现：你的嵌入（以及构建它们的内容）可被任何能到达此端口的人读取。

Redis 与 Postgres 通过其原生线协议而非 HTTP 获得同样对待——`PING`（Redis）或 `StartupMessage`（Postgres）足以了解是否强制认证，且从不发送真实密码。**绝不猜测、暴力或发送任何凭证**——这里的每次检查都是只读指纹识别，与本 monorepo 中 `dns-intelligence` 与 `ssl-inspector` 已在做的同一类探测。

---

## 功能

- **6 种目标类型**：Weaviate、Qdrant、Chroma、Elasticsearch/OpenSearch（HTTP）、Redis（原始 RESP）、Postgres/pgvector（原始线协议）
- **自动检测** — 未指定 `type` 时依次尝试每种已知类型以指纹识别端点
- **从零实现的 Redis 与 Postgres 协议** — 无客户端库依赖，从不发送真实凭证，包含 Postgres `SSLRequest` 握手的 TLS 升级路径
- 升级检查（info → schema → data），因此 “critical” 发现始终意味着实际读取了真实数据，而不仅仅是端口有响应
- SARIF 2.1.0 输出 — CI/CD 集成（GitHub Code Scanning 等）
- 通过 `guardbee.yml` 支持配置文件
- 22 个单元测试，对照本地 mock HTTP/TCP 服务器，覆盖每种探测的匹配/不匹配指纹与每个升级级别

---

## 快速开始

### Claude Desktop / MCP 客户端

```json
{
  "mcpServers": {
    "guardbee-vector-store-scanner": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-vector-store-scanner"]
    }
  }
}
```

### CLI（CI/CD）

```bash
npx @guardbee/mcp-vector-store-scanner scan my-qdrant.internal --type=qdrant --fail-on=high --format=sarif > results.sarif
```

---

## MCP 工具

| 工具 | 说明 |
|------|----------|
| `scan_endpoint` | 探测单个主机/端口的未认证暴露 |
| `list_patterns` | 列出支持的存储类型及每项检查查找什么 |

---

## 捕获内容

| 存储 | 检查 | 严重级别 |
|---|---|---|
| Weaviate | `/v1/meta` 无需认证可读 | medium |
| Weaviate | `/v1/schema` 无需认证可读 — 暴露类名 | high |
| Weaviate | `/v1/objects` 无需认证返回真实数据 | critical |
| Qdrant | `/` 实例信息无需认证可读 | medium |
| Qdrant | `/collections` 无需认证可读 | high |
| Qdrant | `/collections/<name>/points/scroll` 无需认证返回真实数据 | critical |
| Chroma | heartbeat 无需认证可达 | medium |
| Chroma | `/collections` 无需认证可读 | high |
| Elasticsearch/OpenSearch | 集群信息无需认证可读 | medium |
| Elasticsearch/OpenSearch | `/_cat/indices` 无需认证可读 | high |
| Elasticsearch/OpenSearch | `/<index>/_search` 无需认证返回真实文档 | critical |
| Redis | 无 `AUTH` 时接受 `PING` | critical |
| Postgres/pgvector | 未提供 TLS | medium |
| Postgres/pgvector | 无密码挑战即 `AuthenticationOk` | critical |

---

## 配置（`guardbee.yml`）

```yaml
vector-store-scanner:
  fail-on: high       # any | critical | high | medium | low | none
  timeout-ms: 4000
```

---

## 限制（设计如此）

- 不检查 Chroma 的实际文档读取——其数据读取 API 跨版本差异很大，因此本扫描器对其停在 collection 列表级别（仍足以检测主要的“完全无认证”错误配置）。
- 不支持 Milvus——其主要 API 是 gRPC，无法像其他产品那样通过轻量探测做指纹识别。
- 本工具检查的是**未认证读访问**，而非在工作认证层背后的授权 bug（例如有效但权限过高的 API 密钥）— 那超出外部、无凭证探测的范围。

---

## 开发

```bash
npm run build
npm test             # 22 unit tests
```

---

## 许可证

MIT — [GuardBee](https://guardbee.ai)
