# @guardbee/mcp-dependency-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文** | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-dependency-auditor.svg)](https://www.npmjs.com/package/@guardbee/mcp-dependency-auditor)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-dependency-auditor.svg)](https://www.npmjs.com/package/@guardbee/mcp-dependency-auditor)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

一个 MCP 服务器，对照 [OSV](https://osv.dev) 数据库审计 npm 与 pip 清单中的已知 CVE。单包查询还覆盖 PyPI、crates.io、Maven、Go 与 RubyGems。

> 遥测默认**关闭**。设置 `GUARDBEE_TELEMETRY=1` 后会发送服务器、工具、成功与否、耗时以及文件路径等简短参数值；更长的字符串和 `content`、`token`、`password` 等字段会被占位符替换。参见 [`@guardbee/mcp-telemetry`](../telemetry/ZH.md)。

---

## 功能

- **OSV API 集成** —— Google 的开源漏洞数据库（免费，无需身份验证）
- **npm 支持** —— 从 `package-lock.json` / `npm-shrinkwrap.json`（v1/v2/v3）、`pnpm-lock.yaml`（v5/v6/v9）、`yarn.lock`（v1 与 Berry）和 `bun.lock` 读取精确版本，否则回退到 `package.json` 的版本范围。包含传递依赖；即使锁文件未标记（pnpm v9、yarn、bun），也能区分仅开发用的包
- **Rust、Go、Ruby、PHP** —— `Cargo.lock`（从 `Cargo.toml` 识别开发依赖）、`go.mod`（支持 `// indirect` 与 `replace`）、`Gemfile.lock`（合并平台构建，从 `Gemfile` 读取开发组）和 `composer.lock`（`packages-dev`），由 `audit` 命令和 `audit_directory` 工具审计
- **pip 支持** —— 从 `uv.lock`、`poetry.lock` 和 `Pipfile.lock` 读取精确版本（区分开发依赖组），否则回退到 `requirements.txt`、`requirements/base.txt`、`requirements/prod.txt` 与 `pyproject.toml`
- **恶意包检测** —— 已知恶意版本（OpenSSF `MAL-*` 条目及归类为 CWE-506 的公告，例如 2025 年 9 月被劫持的 `chalk@5.6.1` / `debug@4.4.2`）以 critical 级别列在报告最前面，并附带删除与凭据轮换建议；在任何 `--fail-on` 阈值下都会使构建失败
- **利用优先级** —— 使用 [CISA KEV](https://www.cisa.gov/known-exploited-vulnerabilities-catalog)（在野利用、勒索软件使用）和 [FIRST EPSS](https://www.first.org/epss/)（30 天内被利用的概率）丰富发现，并按 恶意包 → KEV → 严重程度 → EPSS 排序。可用 `--fail-on-kev` / `--fail-on-epss=<0-1>` 作为 CI 门禁（`--fail-on=none` 关闭严重程度门禁）。仅发送 CVE ID；使用 `--no-exploit-data` 或在 `guardbee.yml` 中设置 `exploit-data: false` 关闭
- **严重程度评分** —— 基于 CVSS 分数或文本启发式的 Critical / High / Medium / Low
- **修复计划** —— 每个包一次升级：能修复*全部*公告的最小已列出版本（如 `log4j-core 2.14.1 → 2.25.4 (fixes 7/7)`），并标注仍未修复的公告和主版本跨越。单条发现的修复版本沿用已安装的版本线（`next-auth 5.0.0-beta.31 → 5.0.0-beta.32`，而非 4.24.15），使用 SemVer、PEP 440 或 Maven 风格的版本排序
- **CVE 链接** —— 直达 NVD 或 osv.dev 的链接
- **依赖路径** —— 每条发现都会显示该包的安装链（`express@4.21.2 › proxy-addr@2.0.7`），修复计划会指出需要升级的直接依赖（`← via express@4.21.2`）。适用于 `package-lock.json` v2/v3、pnpm、yarn、bun 和 uv 锁文件
- **去重的发现** —— 互为别名的公告（GHSA + PYSEC、GHSA + MAL）合并为一条；忽略列表可匹配其中任一 ID
- **测试** —— 使用真实包管理器生成的锁文件和模拟 OSV API 的单元测试

---

## 快速开始

```bash
npm install -g @guardbee/mcp-dependency-auditor
```

添加到 `claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "guardbee-dependency-auditor": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-dependency-auditor"]
    }
  }
}
```

---

## MCP 工具

| 工具 | 说明 |
|------|----------|
| `audit_npm` | 审计 npm 依赖（package-lock、pnpm、yarn、bun 锁文件或 `package.json`） |
| `audit_pip` | 审计 Python 依赖（uv、Poetry、Pipenv 锁文件或 `requirements.txt` / `pyproject.toml`） |
| `audit_package` | 按名称、版本与生态系统审计单个包 |
| `audit_directory` | 自动检测并审计所有受支持的清单文件 |

### 使用示例

你可以这样问 Claude：

> "审计我项目的 npm 依赖：`/Users/me/my-app`"

> "lodash 4.17.20 有 CVE 吗？"

> "扫描我的 Python 项目：`/Users/me/django-app`"

### 输出示例

```
⚠️  Found 3 vulnerabilities in 2/142 npm packages (1243ms)
   Critical: 1  High: 1  Medium: 1  Low: 0  Unknown: 0

[CRITICAL] lodash@4.17.20
  ID      : GHSA-35jh-r3h4-6jhm (CVE-2021-23337)
  Summary : Command injection via template
  Fix     : upgrade to lodash@4.17.21
  Details : https://nvd.nist.gov/vuln/detail/CVE-2021-23337
```

---

## 支持的生态系统

`audit_package` 工具可直接查询这些生态系统：

| 生态系统 | 参数 |
|-----------|-----------|
| npm | `npm` |
| Python | `PyPI` |
| Rust | `crates.io` |
| Java | `Maven` |
| Go | `Go` |
| Ruby | `RubyGems` |

---

## CLI — CI/CD 集成

除 MCP 服务器模式外，也可直接作为 CLI 使用：

```bash
# Audit all dependencies in a directory (npm + pip auto-detected)
npx @guardbee/mcp-dependency-auditor audit ./my-project

# npm only
npx @guardbee/mcp-dependency-auditor audit-npm . --fail-on=critical

# pip only
npx @guardbee/mcp-dependency-auditor audit-pip . --fail-on=high

# Single package
npx @guardbee/mcp-dependency-auditor audit-pkg lodash 4.17.20 npm

# JSON output
npx @guardbee/mcp-dependency-auditor audit . --format=json

# 仅在攻击者实际利用时失败：CISA KEV，或 EPSS ≥ 10%
npx @guardbee/mcp-dependency-auditor audit . --fail-on=none --fail-on-kev --fail-on-epss=0.1
```

**退出码：** `0` = 干净 · `1` = 超过阈值的发现 · `2` = 错误

### GitHub Actions

```yaml
name: Dependency Audit
on: [push, pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - name: Audit dependencies
        run: npx @guardbee/mcp-dependency-auditor audit . --fail-on=high
```

### GitLab CI

```yaml
dependency-audit:
  image: node:20
  script:
    - npx @guardbee/mcp-dependency-auditor audit . --fail-on=high
  only:
    - merge_requests
    - main
```

### Pre-commit Hook

```bash
# .git/hooks/pre-push
npx @guardbee/mcp-dependency-auditor audit . --fail-on=critical || exit 1
```

---

## 开发

```bash
npm install
npm test          # 20 unit tests
npm run build     # TypeScript compile
```

---

## 许可证

MIT — [GuardBee](https://guardbee.ai)

## 反馈

有问题、想法或误报？请在 [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) 发帖或[提交 issue](https://github.com/GuardBee/guardbee-mcp/issues)。如果 GuardBee 对你有帮助，给[仓库](https://github.com/GuardBee/guardbee-mcp)点个 ⭐ 能让更多人发现它。
