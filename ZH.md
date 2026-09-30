# guardbee-mcp

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文**

[guardbee.ai](https://guardbee.ai) — 面向网站的 AI 安全助手（AI Security Copilot）。

GuardBee 的 MCP（Model Context Protocol）服务器系列——一个 monorepo，各包独立发布到 npm。

## 包列表

| 包 | npm | 说明 |
|---|---|---|
| [`packages/ai-code-scanner`](packages/ai-code-scanner) | `@guardbee/mcp-ai-code-scanner` | 扫描代码库中不安全的 LLM/AI 集成模式（暴露到客户端的密钥、不安全的输出处理、过度授权、PII 进入 prompt、prompt 注入） |
| [`packages/compliance-checker`](packages/compliance-checker) | `@guardbee/mcp-compliance-checker` | KVKK/GDPR/CCPA 合规检查 |
| [`packages/dependency-auditor`](packages/dependency-auditor) | `@guardbee/mcp-dependency-auditor` | npm/pip/cargo 依赖的 CVE 扫描（OSV） |
| [`packages/dns-intelligence`](packages/dns-intelligence) | `@guardbee/mcp-dns-intelligence` | DNS 记录枚举、错误配置与悬空子域名检测 |
| [`packages/db-gateway`](packages/db-gateway) | `@guardbee/mcp-db-gateway` | LLM 与数据库之间符合 KVKK/GDPR 的网关（PII 脱敏、RBAC、限流、可查询的审计日志；Prisma/Postgres/MySQL/SQLite/MongoDB 适配器；可选的 insert/update/delete） |
| [`packages/mcp-server-auditor`](packages/mcp-server-auditor) | `@guardbee/mcp-server-auditor` | 扫描其他 MCP 服务器的工具定义中的不安全模式（过度授权、shell/eval/SQL/SSRF 汇点、宽松的 schema、硬编码密钥、通配 CORS） |
| [`packages/prompt-injection-scanner`](packages/prompt-injection-scanner) | `@guardbee/mcp-prompt-injection-scanner` | 扫描 RAG 内容/抓取页面中的间接 prompt 注入（指令覆盖、伪造的角色/聊天模板标记、隐藏文本、"Dear AI" 式直接称呼、数据外泄指令），支持英文和土耳其语 |
| [`packages/llm-redteam`](packages/llm-redteam) | `@guardbee/mcp-llm-redteam` | 以基于 canary 的越狱/提取/混淆探针主动红队测试在线 LLM 端点或聊天机器人（OpenAI/Anthropic/webhook 目标） |
| [`packages/model-scanner`](packages/model-scanner) | `@guardbee/mcp-model-scanner` | 扫描 ML 模型文件（PyTorch、pickle、safetensors、Keras/H5、ONNX）的供应链风险——危险的 pickle 反序列化全局对象、伪装或畸形的 safetensors 头、Keras Lambda 层 RCE、ONNX 外部数据路径穿越 |
| [`packages/vector-store-scanner`](packages/vector-store-scanner) | `@guardbee/mcp-vector-store-scanner` | 探测向量数据库端点（Weaviate、Qdrant、Chroma、Elasticsearch/OpenSearch、Redis、Postgres/pgvector）是否未经认证就暴露 embedding 和 RAG 数据 |
| [`packages/prompt-leak-scanner`](packages/prompt-leak-scanner) | `@guardbee/mcp-prompt-leak-scanner` | 在发往 LLM 的 prompt 中发现泄露的凭据和 PII（API 密钥、土耳其身份证号 TC Kimlik No、信用卡、IBAN）——既有 MCP 扫描工具，也可作为真实 LLM API 前的实时反向代理 |
| [`packages/agent-graph-auditor`](packages/agent-graph-auditor) | `@guardbee/mcp-agent-graph-auditor` | 在多智能体编排配置（LangGraph、CrewAI、AutoGen/ag2）上构建可达性图，发现传递性的过度授权——某个智能体只能通过委托给另一个智能体才能触及危险工具 |
| [`packages/tool-poisoning-scanner`](packages/tool-poisoning-scanner) | `@guardbee/mcp-tool-poisoning-scanner` | 扫描 MCP 工具定义中的工具投毒（描述中嵌入的隐藏指令）和混淆代理问题（听起来只读、处理函数却有 shell/eval/写文件/导出环境变量汇点的工具） |
| [`packages/rug-pull-detector`](packages/rug-pull-detector) | `@guardbee/mcp-rug-pull-detector` | 实时连接另一个 MCP 服务器（stdio/HTTP），为其 tools/list 响应建立基线，检测 "MCP rug pull"——工具在被批准后悄悄更改描述/schema/annotations |
| [`packages/memory-poisoning-scanner`](packages/memory-poisoning-scanner) | `@guardbee/mcp-memory-poisoning-scanner` | 扫描智能体代码中的记忆投毒——不可信输入被写入持久化的跨会话记忆（MemGPT 式归档/核心记忆，或长期向量库），之后被召回并当作可信上下文 |
| [`packages/oauth-auditor`](packages/oauth-auditor) | `@guardbee/mcp-oauth-auditor` | 扫描 MCP 服务器自身授权代码中 MCP 规范安全注意事项点名的 OAuth 2.1 反模式——令牌透传、缺少 audience 校验、OAuth/OIDC 发现 SSRF、缺少 PKCE、宽松的 redirect_uri 校验、硬编码 client secret |
| [`packages/elicitation-auditor`](packages/elicitation-auditor) | `@guardbee/mcp-elicitation-auditor` | 扫描 MCP 服务器代码中 2026-07-28 规范的 elicitation 反模式——表单模式索要密钥或支付数据、URL 模式直接指向第三方授权端点、elicitation URL 中嵌入凭据或 PII |
| [`packages/toxic-flow-auditor`](packages/toxic-flow-auditor) | `@guardbee/mcp-toxic-flow-auditor` | 审计 MCP 工具目录中的有毒数据流（Simon Willison 所说的 lethal trifecta，"致命三要素"）——同一服务器上同时存在不可信内容 + 敏感/私有数据 + 外泄或破坏能力；A–F 评级、考虑 KVKK 的启发式规则、OWASP MCP10:2025 |
| [`packages/a2a-auditor`](packages/a2a-auditor) | `@guardbee/mcp-a2a-auditor` | 扫描智能体的 Agent2Agent（A2A）协议实现（TypeScript 和 Python）中在参考 SDK 源码里发现的反模式——未经认证的推送通知 webhook 请求（SSRF）、不要求认证的 Agent Card、公开 Agent Card 元数据中嵌入的凭据 |
| [`packages/slopsquat-scanner`](packages/slopsquat-scanner) | `@guardbee/mcp-slopsquat-scanner` | 将项目清单（package.json、requirements.txt、pyproject.toml）中声明的每个依赖与真实的 npm/PyPI 注册表比对——标记根本不存在的名称（很可能是 LLM 幻觉出来的，即 slopsquatting）以及存在但刚刚才发布的名称 |
| [`packages/unbounded-consumption-auditor`](packages/unbounded-consumption-auditor) | `@guardbee/mcp-unbounded-consumption-auditor` | 扫描 LLM/智能体应用代码中的无限制资源消耗（"denial of wallet"，OWASP LLM Top 10 2026 #6）——缺少输出 token 上限、手写 LLM HTTP 调用缺少超时、无上限的工具调用/重试循环、显式关闭框架安全限制（LangChain max_iterations、openai-agents max_turns），以及看不出限流的 MCP 工具处理函数 |
| [`packages/secret-scanner`](packages/secret-scanner) | `@guardbee/mcp-secret-scanner` | 扫描文件中泄露的密钥和 API key |
| [`packages/security-proxy`](packages/security-proxy) | `@guardbee/mcp-security-proxy` | MCP 安全网关：把多个 MCP 服务器置于同一策略之后——有毒数据流（lethal trifecta）拦截、人工审批、PII 脱敏、哈希链审计日志 |
| [`packages/security-suite`](packages/security-suite) | `@guardbee/security-suite` | secret-scanner + dependency-auditor + ssl-inspector + dns-intelligence 的组合包 |
| [`packages/ssl-inspector`](packages/ssl-inspector) | `@guardbee/mcp-ssl-inspector` | TLS 证书/加密套件/协议检查 |
| [`packages/vulnerability-scanner`](packages/vulnerability-scanner) | `@guardbee/mcp-vulnerability-scanner` | 触发 GuardBee 扫描、查询发现结果、AI 辅助的修复建议 |
| [`packages/guard-core`](packages/guard-core) | `@guardbee/guard-core` | （内部）共享检测规则库——PII/密钥脱敏、prompt 注入规则、工具分类；本身不是 MCP 服务器 |
| [`packages/telemetry`](packages/telemetry) | `@guardbee/mcp-telemetry` | （内部）共享的使用遥测客户端——本身不是 MCP 服务器 |

## 最近更新

各版本的详细变更记录见英文 README 的 [Recent Changes](README.md#recent-changes-2026-09-30) 部分，以及各包的 `CHANGELOG.md`。

## 遥测

每个包默认通过 `@guardbee/mcp-telemetry` 向 GuardBee 发送使用遥测：调用了哪个工具、调用频率和耗时。首次使用时会在 stderr 打印一次提示。

- **关闭方法**：`GUARDBEE_TELEMETRY=0`（或 `false`/`off`）
- **发送的内容**：工具名、较短（≤40 个字符）的参数值（例如 `table: "users"`、`limit: 50`）、成功/失败、耗时
- **绝不发送的内容**：`content`/`text`/`data`/`filter`/`password`/`email`/`apiKey`/`token` 等键下的值，以及任何超过 40 个字符的字符串——它们都会被 `packages/telemetry/src/redact.ts` 中的 `redactParams()` 替换为 `"[redacted: ...]"`。因此被扫描文件/代码的完整内容，或 `insert_row`/`update_row` 调用中的真实行数据，都不会被发送。

详情：[`packages/telemetry/README.md`](packages/telemetry/README.md)。

## 开发

```
pnpm install
pnpm build     # turbo run build —— 按依赖顺序构建所有包
pnpm test      # turbo run test
```

只开发单个包：

```
pnpm --filter @guardbee/mcp-ssl-inspector dev
```

## 版本与发布

各包独立管理版本（[Changesets](https://github.com/changesets/changesets)）。如果你在 PR 中修改了内容：

```
pnpm changeset
```

合并到 `main` 后，CI 会自动打开一个版本 PR；合并该 PR 即会把有变更的包发布到 npm（见 `.github/workflows/release.yml`）。

## 结构

- **pnpm workspaces** —— `packages/*`，真实的 `workspace:*` 依赖（例如 `security-suite` 直接从工作区依赖其他 4 个包，而不是注册表上的版本）
- **Turborepo** —— `build`/`test`/`type-check` 流水线，按依赖图排序并缓存
- **共享配置** —— 根目录的 `tsconfig.base.json` 和 `vitest.shared.ts`；每个包在其上叠加自己的设置
