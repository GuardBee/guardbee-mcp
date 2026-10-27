# @guardbee/mcp-elicitation-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文** | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

一个 MCP 服务器，用于扫描 MCP 服务器源码中 **2026-07-28 规范里的 elicitation 反模式**。

该修订版弃用了 sampling 与 roots。Elicitation 是服务器向客户端请求信息的剩余方式。Form 模式通过客户端收集结构化数据。URL 模式把用户送到客户端不得读取的页面。规范在两者之间划了硬线。

> 遥测默认**关闭**。设置 `GUARDBEE_TELEMETRY=1` 后会发送服务器、工具、成功与否、耗时以及文件路径等简短参数值；更长的字符串和 `content`、`token`、`password` 等字段会被占位符替换。参见 [`@guardbee/mcp-telemetry`](../telemetry/ZH.md)。

```
Claude ──► elicitation-auditor ──► MCP server source
              │
              ├─ form-secrets   (form mode asks for a password, API key, token, or card, or embeds a link)
              ├─ url-binding    (URL mode opens a third-party /authorize endpoint directly)
              ├─ url-exposure   (credential or email embedded in the elicitation URL)
              ├─ transport      (cleartext http URL outside localhost)
              ├─ identity       (a form answer is treated as who the user is)
              └─ completion     (the result is used without checking decline or cancel)
```

## 标记内容

- **Form 模式密钥。** `elicitInput` / `ctx.elicit` / `elicitation/create` 在省略 mode 或为 `form` 时，其 schema 索要 `password`、`apiKey`、`access_token`、`cvv` 及同类字段。姓名与邮箱表单为规范所允许，不会被标记。`secretQuestion` 不视为 `secret`。
- **直接第三方 authorize。** URL 模式的 `url` 路径包含 `authorize`、`oauth` 或 `oauth2`，且未经过你自己的 `/connect` 路由。这是规范中的转发链接钓鱼情形：打开链接的用户必须在任何重定向前与 MCP 用户核对。
- **URL 中的凭据或个人数据。** 诸如 `access_token`、`code` 或 `email` 的查询键。该 URL 会展示给 MCP 客户端。
- **明文 HTTP**，`localhost` 与 `127.0.0.1` 除外。
- **表单中的可点击 URL。** 表单消息或字段描述中含有 `http` 链接。规范要求该链接应属于 URL 模式。
- **表单答案被当作身份。** 提交的邮箱或用户名被传给 `findUser`、`loginAs`，或赋给 `req.user`，且未与 token 的 `sub` 声明比较。
- **忽略 decline/cancel。** 代码读取 `.content` 却从不查看 `.action`、`decline` 或 `cancel`。检查 `action !== "accept"` 即足够。把邮箱当作通知地址发送不视为身份核对。

## 工具

| 工具 | 用途 |
|---|---|
| `scan_text` | 扫描源码字符串 |
| `scan_file` | 扫描单个文件 |
| `scan_directory` | 递归扫描 |
| `list_patterns` | 列出检查项 |

## CLI

```
npx @guardbee/mcp-elicitation-auditor scan <path> [--fail-on=any] [--format=text|json|sarif]
```

`guardbee.yml`：

```yaml
elicitation-auditor:
  fail-on: high
  max-files: 5000
  exclude:
    - ".test.ts"
```

无需 API 密钥。仅做静态分析。

## 反馈

有问题、想法或误报？请在 [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) 发帖或[提交 issue](https://github.com/GuardBee/guardbee-mcp/issues)。如果 GuardBee 对你有帮助，给[仓库](https://github.com/GuardBee/guardbee-mcp)点个 ⭐ 能让更多人发现它。
