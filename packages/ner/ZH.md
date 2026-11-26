# @guardbee/ner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文** | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> 这是简短摘要。完整文档（英文）见 [README.md](README.md)。

识别正则表达式无法识别的土耳其语人名，让 GuardBee 能把它们与 TC Kimlik 号、IBAN 和邮箱地址一起脱敏。本地 BERTurk NER 模型通过 ONNX Runtime 在 CPU 上运行：离线、本地部署，数据不离开主机。它是可选的，GuardBee 的正则检测器不依赖它；适用于名字很重要的场景：客服工单、人事记录、法律文本、聊天记录。人名 F1：模板集 99.5，难例集 97.1；每份文档 p50 8 ms。

## 安装

```bash
npm install @guardbee/ner
npx guardbee-ner download        # ~186 MB, SHA-256
```

## 用法

```ts
import { NerModel } from "@guardbee/ner";
import { maskPiiInText } from "@guardbee/guard-core";

const ner = await NerModel.load();
const text = "Müşteri Ayşe Yılmaz'ın TC'si 10000000146";
const [found] = await ner.detect([text]);
maskPiiInText(text, undefined, undefined, undefined, () => found);
// → "Müşteri [KİŞİ]'ın TC'si [TC-KİMLİK]"
```

```bash
GUARDBEE_NER_TOKEN=change-me npx guardbee-ner serve --port 8765   # sidecar, 127.0.0.1
```

## 限制

只识别人名（不含地名和机构名），且只支持土耳其语。同时也是人名的大写词（Barış、Umut、Deniz）位于句首时可能被误判。

详细说明见 [README.md](README.md)。

## 许可证

MIT

## 反馈

有问题、想法或误报？请在 [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) 发帖或[提交 issue](https://github.com/GuardBee/guardbee-mcp/issues)。如果 GuardBee 对你有帮助，给[仓库](https://github.com/GuardBee/guardbee-mcp)点个 ⭐ 能让更多人发现它。
