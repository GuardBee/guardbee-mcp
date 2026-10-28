# @guardbee/mcp-reverse-shield

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文**

一个告诉你**已发布的应用会把什么白白送给逆向工程者**的 MCP 服务器。

逆向工程 MCP 如今可以让智能体拿到一个没有源码的应用（Web 打包文件、Electron 应用、APK、原生或 .NET 二进制），一直解释到二进制层面某个功能是如何实现的。本包是它的另一面：把它指向*你自己*的构建产物，它会报告这类工具（或使用 jadx、ILSpy、Hopper、浏览器开发者工具的人）不费力气就能拿到的东西，并给出每一项的修复方法。

> 遥测默认**关闭**。设置 `GUARDBEE_TELEMETRY=1` 后会发送服务器、工具、是否成功、耗时以及文件路径等简短参数；较长的字符串以及 `content`、`token`、`password` 等字段会被替换为占位符。参见 [`@guardbee/mcp-telemetry`](../telemetry/README.md)。

```
Claude ──► reverse-shield ──► 你的构建产物 / 线上站点
              │
              ├─ web       source map（随包发布、内联、可公开下载）、未压缩 / 开发版打包、密钥、内部主机
              ├─ electron  fuse（RunAsNode、--inspect、NODE_OPTIONS、ASAR 完整性）、未打包的应用代码、app.asar 内的代码
              ├─ android   APK 与 AAB：debuggable、未启用 R8/ProGuard、签名方案、备份、明文 React Native 包、未剥离符号的 .so
              ├─ ios       IPA 与 .app：以 Debug 配置构建、开发描述文件、明文 React Native 包、可执行文件
              ├─ 引擎      Unity（IL2CPP 元数据、Mono 程序集）、PyInstaller、Java/Spring Boot JAR、Flutter
              ├─ native    调试信息、符号、get-task-allow、hardened runtime、签名、PIE/NX/RELRO/canary（ELF、Mach-O、PE）
              └─ .NET      未混淆、内嵌 PDB、泄露的构建路径
```

除 `scan_url` 外全部在本地离线运行，自带 ASAR、Electron fuse wire、二进制 AndroidManifest（AXML）、DEX、ELF、Mach-O（含通用二进制与代码签名）以及 PE/.NET 元数据解析器，无需 apktool、jadx 或 binutils。

## 工具

| 工具 | 用途 |
|---|---|
| `scan_artifact` | 扫描文件或目录：APK、AAB、IPA、iOS 或 macOS `.app`、Electron 目录、`app.asar`、JAR、ELF/Mach-O/PE/.NET 二进制、JS 打包文件、source map 或构建输出目录（含 Unity 与 Python 构建）。可选 `ignore` 与 `baseline` |
| `suggest_fixes` | 读取项目构建配置（Vite、webpack、Next.js、Angular、CRA、Android Gradle 与清单、React Native、electron-builder / Forge、.NET 项目文件、Flutter），以 unified diff 形式返回修改建议，不写入任何文件 |
| `scan_url` | 抓取线上页面，检查同站点的打包脚本，跟随 `sourceMappingURL` 并尝试 `<bundle>.map`（不抓取第三方脚本） |
| `list_checks` | 检查项目录，包括每项泄露了什么以及如何修复 |

每个结果都带有 **A–F 评级**：存在严重问题（或多个高危问题）时为 F，没有任何问题时为 A。

## 快速开始

```json
{
  "mcpServers": {
    "guardbee-reverse-shield": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-reverse-shield"]
    }
  }
}
```

```bash
npx @guardbee/mcp-reverse-shield scan ./dist --fail-on=high
npx @guardbee/mcp-reverse-shield scan ./app/build/outputs/apk/release/app-release.apk
npx @guardbee/mcp-reverse-shield scan https://app.example.com --format=sarif > reverse-shield.sarif
npx @guardbee/mcp-reverse-shield scan ./dist --update-baseline        # 记录基线，之后用 --baseline=… 只对新增问题报错
npx @guardbee/mcp-reverse-shield suggest . --format=patch | git apply  # 应用前请先审阅
```

## 限制

- 混淆仅根据名称判断，不分析控制流：只做重命名的构建会通过，字符串加密或控制流平坦化不在衡量范围内。
- Web 检查只看发布出去的内容，无法判断某个密钥是否本就应当公开（例如 Firebase Web 密钥在服务端受限）。
- 原生加固检查（PIE/NX/RELRO/canary）更多是漏洞利用缓解信号，因此以 low/medium 报告。
- `suggest_fixes` 只处理各配置的常见写法；非常规结构不会生成 diff，Forge 与 Flutter 给出说明而非补丁。应用前务必审阅。

## 许可证

MIT
