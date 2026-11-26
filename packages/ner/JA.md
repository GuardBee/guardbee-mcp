# @guardbee/ner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | **🇯🇵 日本語** | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> これは短い概要です。完全なドキュメント（英語）は [README.md](README.md) をご覧ください。

正規表現では見つけられないトルコ語の人名を検出し、GuardBee が TC Kimlik 番号、IBAN、メールアドレスと一緒にマスクできるようにします。ローカルの BERTurk NER モデルを ONNX Runtime で CPU 上で実行します。オフライン・オンプレミスで動作し、データはホストから出ません。オプションであり、GuardBee の正規表現検出器には不要です。サポートチケット、人事メモ、法務文書、チャットログなど名前が重要な場面で使います。人名 F1 はテンプレートセットで 99.5、難しい名前のセットで 97.1、1 文書あたり p50 8 ms です。

## インストール

```bash
npm install @guardbee/ner
npx guardbee-ner download        # ~186 MB, SHA-256
```

## 使い方

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

## 制限

対象は人名のみ（地名・組織名は対象外）で、トルコ語のみです。人名でもある大文字の単語（Barış、Umut、Deniz）は文頭ではどちらにも判定されることがあります。

詳細は [README.md](README.md) を参照してください。

## ライセンス

MIT

## フィードバック

質問、アイデア、誤検知の報告は [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) か [issue](https://github.com/GuardBee/guardbee-mcp/issues) へどうぞ。GuardBee が役に立ったら、[リポジトリ](https://github.com/GuardBee/guardbee-mcp)への ⭐ が他の人の発見につながります。
