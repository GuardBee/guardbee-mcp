# @guardbee/mcp-document-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | **🇧🇷 Português** | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> Este é um resumo curto. A documentação completa (em inglês) está em [README.md](README.md).

Servidor MCP e CLI que encontra **dados pessoais e credenciais dentro de documentos** — PDFs, capturas de tela, páginas digitalizadas — antes que cheguem a um LLM. Primeiro lê a camada de texto do PDF e, para imagens e páginas sem texto, usa OCR (turco e inglês). Detecta, entre outros, TC Kimlik, VKN, IBAN, cartões (com dígito verificador), passaporte, SGK, MERSİS, data de nascimento, endereço, e-mail, KEP, telefone e mais de 22 formatos de credenciais. Os achados mostram apenas o primeiro e o último caractere.

> A telemetria vem **desativada** por padrão. Com `GUARDBEE_TELEMETRY=1`, são enviados o servidor, a ferramenta, o sucesso, a duração e valores curtos de parâmetros, como um caminho de arquivo; textos mais longos e campos como `content`, `token` ou `password` são substituídos por um marcador. Veja [`@guardbee/mcp-telemetry`](../telemetry/PT-BR.md).

## Instalação

```bash
npx -y @guardbee/mcp-document-scanner scan ./contracts
npm i -g @guardbee/mcp-document-scanner tesseract.js @napi-rs/canvas   # + OCR
```

## Ferramentas MCP

`scan_document`, `scan_base64`, `list_detectors`

Os detalhes estão em [README.md](README.md).

## Uso

```bash
guardbee-document-scanner scan <file|folder> [--format=text|json|sarif] [--fail-on=...] [--no-ocr] [--lang=tur,eng]
```

No [`@guardbee/mcp-security-proxy`](../security-proxy), `interceptors.documents` usa este pacote: imagens e PDFs embutidos nos resultados das ferramentas são analisados antes que o modelo os veja.

## Licença

MIT

## Feedback

Dúvidas, ideias ou um falso positivo? Abra um tópico no [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) ou [uma issue](https://github.com/GuardBee/guardbee-mcp/issues). Se o GuardBee for útil para você, uma ⭐ no [repositório](https://github.com/GuardBee/guardbee-mcp) ajuda outras pessoas a encontrá-lo.
