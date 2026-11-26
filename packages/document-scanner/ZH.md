# @guardbee/mcp-document-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文** | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> 这是简短摘要。完整文档（英文）见 [README.md](README.md)。

在文档交给 LLM 之前，找出 PDF、截图和扫描件中的**个人数据与凭据**的 MCP 服务器和 CLI。先读取 PDF 文本层，对图片和没有文本的页面使用 OCR（土耳其语和英语）。可检测 TC Kimlik 号、VKN、IBAN、银行卡（校验和验证）、护照、SGK、MERSİS、出生日期、地址、邮箱、KEP、电话以及 22 种以上的凭据格式。结果只显示值的首尾字符。

> 遥测默认**关闭**。设置 `GUARDBEE_TELEMETRY=1` 后会发送服务器、工具、成功与否、耗时以及文件路径等简短参数值；更长的字符串和 `content`、`token`、`password` 等字段会被占位符替换。参见 [`@guardbee/mcp-telemetry`](../telemetry/ZH.md)。

## 安装

```bash
npx -y @guardbee/mcp-document-scanner scan ./contracts
npm i -g @guardbee/mcp-document-scanner tesseract.js @napi-rs/canvas   # + OCR
```

## MCP 工具

`scan_document`, `scan_base64`, `list_detectors`

详细说明见 [README.md](README.md)。

## 用法

```bash
guardbee-document-scanner scan <file|folder> [--format=text|json|sarif] [--fail-on=...] [--no-ocr] [--lang=tur,eng]
```

[`@guardbee/mcp-security-proxy`](../security-proxy) 的 `interceptors.documents` 使用本包：工具结果中的图片和内嵌 PDF 会在模型看到之前被扫描。

## 许可证

MIT

## 反馈

有问题、想法或误报？请在 [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) 发帖或[提交 issue](https://github.com/GuardBee/guardbee-mcp/issues)。如果 GuardBee 对你有帮助，给[仓库](https://github.com/GuardBee/guardbee-mcp)点个 ⭐ 能让更多人发现它。
