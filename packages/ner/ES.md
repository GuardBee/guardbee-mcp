# @guardbee/ner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Encuentra nombres de personas en turco, algo que ninguna regex puede hacer, para que GuardBee los enmascare junto a números TC Kimlik, IBAN y correos. Un modelo NER BERTurk local se ejecuta en CPU con ONNX Runtime: sin conexión, on-prem, nada sale del host. Es opcional: los detectores por regex de GuardBee no lo necesitan. Úsalo donde importan los nombres: tickets de soporte, notas de RR. HH., textos legales, registros de chat. F1 de nombres 99,5 (conjunto de plantillas) y 97,1 (nombres difíciles), p50 de 8 ms por documento.

## Instalación

```bash
npm install @guardbee/ner
npx guardbee-ner download        # ~186 MB, SHA-256
```

## Uso

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

## Límites

Solo nombres (no lugares ni organizaciones) y solo turco. Las palabras en mayúscula que también son nombres (Barış, Umut, Deniz) pueden fallar al inicio de una frase.

Los detalles están en [README.md](README.md).

## Licencia

MIT

## Comentarios

¿Preguntas, ideas o un falso positivo? Abre un hilo en [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) o [una issue](https://github.com/GuardBee/guardbee-mcp/issues). Si GuardBee te resulta útil, una ⭐ en [el repositorio](https://github.com/GuardBee/guardbee-mcp) ayuda a que otros lo encuentren.
