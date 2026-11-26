# @guardbee/ner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

Findet türkische Personennamen, was kein Regex kann, damit GuardBee sie neben TC-Kimlik-Nummern, IBANs und E-Mail-Adressen maskieren kann. Ein lokales BERTurk-NER-Modell läuft mit ONNX Runtime auf der CPU: offline, on-prem, nichts verlässt den Host. Optional – die Regex-Detektoren von GuardBee brauchen es nicht. Sinnvoll, wo Namen wichtig sind: Support-Tickets, HR-Notizen, juristische Texte, Chat-Logs. Personennamen-F1 99,5 (Vorlagen-Set) bzw. 97,1 (schwierige Namen), p50 8 ms pro Dokument.

## Installation

```bash
npm install @guardbee/ner
npx guardbee-ner download        # ~186 MB, SHA-256
```

## Verwendung

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

## Grenzen

Nur Namen (keine Orte oder Organisationen) und nur Türkisch. Großgeschriebene Wörter, die auch Namen sind (Barış, Umut, Deniz), können am Satzanfang in beide Richtungen gehen.

Details stehen in [README.md](README.md).

## Lizenz

MIT

## Feedback

Fragen, Ideen oder ein Fehlalarm? Starte eine Diskussion in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) oder [öffne ein Issue](https://github.com/GuardBee/guardbee-mcp/issues). Wenn GuardBee dir hilft, hilft ein ⭐ für [das Repository](https://github.com/GuardBee/guardbee-mcp) anderen, es zu finden.
