# @guardbee/ner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | **🇧🇷 Português** | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> Este é um resumo curto. A documentação completa (em inglês) está em [README.md](README.md).

Encontra nomes de pessoas em turco, algo que nenhuma regex consegue, para que o GuardBee os mascare junto com números TC Kimlik, IBANs e e-mails. Um modelo NER BERTurk local roda na CPU com ONNX Runtime: offline, on-prem, nada sai do host. É opcional: os detectores por regex do GuardBee não precisam dele. Use onde nomes importam: tickets de suporte, notas de RH, textos jurídicos, logs de chat. F1 de nomes 99,5 (conjunto de modelos) e 97,1 (nomes difíceis), p50 de 8 ms por documento.

## Instalação

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

## Limites

Apenas nomes (não lugares nem organizações) e apenas turco. Palavras em maiúscula que também são nomes (Barış, Umut, Deniz) podem falhar no início de uma frase.

Os detalhes estão em [README.md](README.md).

## Licença

MIT

## Feedback

Dúvidas, ideias ou um falso positivo? Abra um tópico no [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) ou [uma issue](https://github.com/GuardBee/guardbee-mcp/issues). Se o GuardBee for útil para você, uma ⭐ no [repositório](https://github.com/GuardBee/guardbee-mcp) ajuda outras pessoas a encontrá-lo.
