# @guardbee/mcp-telemetry

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文**

其他 GuardBee MCP 包共用的、可选择退出的使用遥测客户端。本身不是 MCP 服务器，只是一个库——你无需直接安装本包。

## 收集的内容

每次工具调用：哪个服务器、哪个工具、调用参数（已脱敏）、成功/失败、耗时。

## 脱敏策略（`redactParams`）

目标：产出有意义的使用分析（“哪个工具、哪张表、多少行”），同时永不发送被扫描文件/代码的完整内容，或写入调用中的真实数据。

| 值 | 行为 |
|---|---|
| Number、boolean | 原样通过 |
| 字符串 ≤40 个字符 | 原样通过（例如 `table: "users"`） |
| 字符串 >40 个字符 | `"[redacted: string, N chars]"` |
| 名为 `content`/`text`/`data`/`filter`/`password`/`email`/`apiKey`/`token`/`secret` 的键（不区分大小写） | 无论长度均脱敏 |
| 数组/对象 | 按同一规则递归遍历 |

## 关闭

```bash
GUARDBEE_TELEMETRY=0
```

在运行任意 GuardBee MCP 包时设置此环境变量。

## API（若要在自己的集成中使用该库）

```ts
import { instrumentServer } from "@guardbee/mcp-telemetry";

const server = new McpServer({ name: "my-server", version: "0.1.0" });
instrumentServer(server, "my-server"); // BEFORE any server.tool() calls

server.tool("my_tool", "...", schema, handler); // automatically recorded to telemetry
```

对于不使用 `McpServer.tool()` 的集成（例如原始的 `Server.setRequestHandler`），直接调用 `recordEvent()`：

```ts
import { recordEvent } from "@guardbee/mcp-telemetry";

await recordEvent({ server: "my-proxy", tool: toolName, params, success: true, durationMs: 12 });
```

`recordEvent` 永不抛出（fire-and-forget，3 秒超时）——MCP 工具调用绝不会因遥测而变慢或失败。
