# @guardbee/guard-core

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文**

其他 GuardBee MCP 包共用的检测规则库。它本身不是 MCP 服务器，只是一个库——你不需要直接安装这个包。

它存在的目的是让同一条规则在所有地方运行：报告某个模式的静态扫描器，和在运行时拦截它的代理，使用的是同一份实现。

## 包含内容

| 导出 | 使用方 | 用途 |
|---|---|---|
| `maskPiiInText`、`maskPiiInValue`、`PII_PATTERNS` | security-proxy | 对工具结果中的土耳其身份证号（TC Kimlik No）、税号（VKN）、IBAN、银行卡、电话、电子邮件、服务商 API 密钥、私钥、数据库连接串和 JWT 进行脱敏；可选的 replacer 可以把匹配项转换为令牌 |
| `SECRET_RULES` | secret-scanner、security-proxy | 38 条密钥规则（服务商密钥和令牌、私钥、数据库连接串、JWT）。扫描器会报告全部规则；代理只对未标记 `broad` 的 32 条进行脱敏 |
| `isValidTcKimlik`、`isValidVkn`、`isValidIban`、`isValidLuhn`、`isValidTrPhone` | security-proxy、prompt-leak-scanner | 正则匹配之后的校验 |
| `INJECTION_RULES`、`findInjections` | prompt-injection-scanner、security-proxy | 27 条英文和土耳其语注入规则，包含 base64 解码；扫描器使用其中 17 条精确规则 |
| `scanForPromptInjection`、`scanToolResult` | security-proxy | 命中精确的 high/critical 规则时拦截，其余情况只警告 |
| `classifyTool`、`CAPABILITY_RULES` | toxic-flow-auditor、security-proxy | 把工具标记为 untrusted-content / sensitive-data / exfiltration / destructive（lethal trifecta） |

## 经校验和验证的脱敏

单靠正则，会把任何 11 位数字当成 TC Kimlik No，把任何 16 位数字当成银行卡号。现在每个匹配在脱敏前都会先经过检查：

| 模式 | 检查 |
|---|---|
| TC Kimlik No | 官方的第 10、11 位校验算法 |
| VKN（税号） | 土耳其税务局（Gelir İdaresi）校验位，且数字前需有 `VKN` / `Vergi No` 标签 |
| IBAN | ISO 7064 MOD97-10 |
| 银行卡号 | Luhn |
| 电话（土耳其） | 手机（5xx）、座机（2xx–4xx）或 850 号段；需带 +90 / 0 前缀，或用空格/短横线分组书写，且不能是 URL 或 ID 的一部分 |

未通过检查的匹配（订单号、快递单号）保持原样。

## 精确规则与通用规则

注入规则和密钥规则都带有一个 `broad` 标记，用于那些在普通文本中也会匹配的模式："act as"、"developer mode"、任意 40 个字符的 base64 串、可公开的 Stripe publishable key。把结果展示给人看的静态扫描器会跳过通用注入规则；运行时代理则从不基于通用规则进行拦截或脱敏，因为在那里一次误匹配还会把会话标记为持有敏感数据，或拦下一次正常调用。
