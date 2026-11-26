# @guardbee/ner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | **🇰🇷 한국어** | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> 이 문서는 짧은 요약입니다. 전체 문서(영어)는 [README.md](README.md)를 참고하세요.

정규식으로는 찾을 수 없는 튀르키예어 인명을 찾아 GuardBee가 TC Kimlik 번호, IBAN, 이메일 주소와 함께 마스킹할 수 있게 합니다. 로컬 BERTurk NER 모델이 ONNX Runtime으로 CPU에서 실행됩니다. 오프라인·온프레미스로 동작하며 데이터가 호스트를 벗어나지 않습니다. 선택 사항이며 GuardBee의 정규식 탐지기에는 필요하지 않습니다. 지원 티켓, 인사 메모, 법률 문서, 채팅 로그처럼 이름이 중요한 곳에 사용하세요. 인명 F1은 템플릿 세트 99.5, 어려운 이름 세트 97.1이며 문서당 p50 8 ms입니다.

## 설치

```bash
npm install @guardbee/ner
npx guardbee-ner download        # ~186 MB, SHA-256
```

## 사용법

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

## 제한

인명만 대상(지명·조직명 제외)이며 튀르키예어만 지원합니다. 인명이기도 한 대문자 단어(Barış, Umut, Deniz)는 문장 첫머리에서 어느 쪽으로든 판정될 수 있습니다.

자세한 내용은 [README.md](README.md)에 있습니다.

## 라이선스

MIT

## 피드백

질문, 아이디어, 오탐이 있나요? [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions)에 글을 남기거나 [이슈를 열어](https://github.com/GuardBee/guardbee-mcp/issues) 주세요. GuardBee가 도움이 되었다면 [저장소](https://github.com/GuardBee/guardbee-mcp)에 ⭐를 눌러 다른 사람도 찾을 수 있게 해 주세요.
