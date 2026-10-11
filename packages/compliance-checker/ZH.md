# @guardbee/mcp-compliance-checker

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文** | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-compliance-checker.svg)](https://www.npmjs.com/package/@guardbee/mcp-compliance-checker)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-compliance-checker.svg)](https://www.npmjs.com/package/@guardbee/mcp-compliance-checker)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

一个 MCP 服务器，通过 GuardBee API 运行 KVKK（土耳其数据保护法）、GDPR 与 CCPA 合规检查，分析隐私政策，并比较法律要求。其中三个工具无需 API 密钥即可使用。

> 本包默认发送使用遥测（工具名 + 较短参数——见 [`@guardbee/mcp-telemetry`](../telemetry/README.md)）。设置 `GUARDBEE_TELEMETRY=0` 即可关闭。

> **`check_compliance` 与 `get_compliance_findings` 工具需要 GuardBee API 密钥。** 请前往 [app.guardbee.ai/developers](https://app.guardbee.ai/developers) 获取。

---

## 功能

- **KVKK / GDPR / CCPA 扫描** — 通过 GuardBee API 触发以合规为重点的扫描并获取发现
- **隐私政策分析** — 从 URL 获取政策文本；10 个合规信号、分数（0-100）与字母等级
- **Cookie Banner 检测** — 检测 OneTrust、Cookiebot、Axeptio 等 10+ CMP 平台
- **要求目录** — 跨 KVKK（9）、GDPR（8）、CCPA（4）共 21 项要求，附法律条文引用
- **框架比较** — KVKK / GDPR / CCPA 的共同与差异条款
- **免密钥工具** — `analyze_privacy_policy`、`list_requirements`、`compare_frameworks` 可离线工作

---

## 快速开始

```bash
npm install -g @guardbee/mcp-compliance-checker
```

添加到 `claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "guardbee-compliance-checker": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-compliance-checker"],
      "env": {
        "GUARDBEE_API_KEY": "gb_..."
      }
    }
  }
}
```

在 [app.guardbee.ai/developers](https://app.guardbee.ai/developers) 获取 API 密钥。

---

## MCP 工具

| 工具 | API 密钥 | 说明 |
|------|:------------:|----------|
| `check_compliance` | 需要 | 为 URL 启动合规扫描（KVKK/GDPR/CCPA） |
| `get_compliance_findings` | 需要 | 获取扫描发现，可按框架与严重级别过滤 |
| `analyze_privacy_policy` | 否 | 分析隐私政策 URL——分数、等级、缺失条款 |
| `list_requirements` | 否 | 列出受支持框架的法律要求 |
| `compare_frameworks` | 否 | 比较 KVKK、GDPR 与 CCPA 的异同 |

### 使用示例

你可以问 Claude：

> "Check example.com's KVKK compliance"

> "List GDPR requirements"

> "Compare the differences between KVKK and GDPR"

> "Analyze the privacy policy at https://example.com/privacy"

### 输出示例

```
Privacy Policy Analysis: https://example.com/privacy
──────────────────────────────────────────────────────
Score : 72/100  Grade: C

✅ Data controller identity disclosed
✅ Purpose of processing stated
✅ Retention periods mentioned
✅ Cookie policy present
❌ Legal basis for processing not stated
❌ Data subject rights not listed (access, erasure, portability)
❌ International transfer safeguards missing
❌ Contact information for DPO missing

Recommendation: Add legal basis statements and data subject rights section.
```

---

## 支持的框架

| 框架 | 要求数量 | 扫描场景 |
|---------|:-----------------:|-----------------|
| KVKK | 9 | `kvkkFocus` |
| GDPR | 8 | `gdprFocus` |
| CCPA | 4 | `ccpaFocus` |

---

## 隐私政策评分

`analyze_privacy_policy` 工具在政策文本中查找 10 个信号：

| 信号 | 说明 |
|--------|----------|
| Data controller identity | 公司/组织名称已说明 |
| Purpose of processing | 为何收集个人数据 |
| Legal basis | 引用 GDPR Art. 6 / KVKK Art. 5 |
| Retention periods | 数据将保留多久 |
| Data subject rights | 访问、删除、可携、异议 |
| Contact / DPO | 如何联系数据控制者 |
| Cookie policy | Cookie 与跟踪技术 |
| Third-party sharing | 数据共享的对象 |
| Security measures | 技术/管理保障措施 |
| International transfer | 跨境传输保障 |

**等级：** A (90-100) · B (75-89) · C (60-74) · D (45-59) · F (0-44)

---

## 环境变量

| 变量 | 说明 |
|----------|----------|
| `GUARDBEE_API_KEY` | GuardBee API 密钥（`check_compliance` 与 `get_compliance_findings` 需要） |
| `GUARDBEE_BASE_URL` | 自定义端点（默认：`https://app.guardbee.ai`） |

---

## 开发

```bash
npm install
npm test          # unit tests
npm run build     # TypeScript compile
```

---

## 许可证

MIT — [GuardBee](https://guardbee.ai)
