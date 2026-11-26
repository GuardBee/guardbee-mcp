# @guardbee/mcp-reverse-shield

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | **🇧🇷 Português** | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> Este é um resumo curto. A documentação completa (em inglês) está em [README.md](README.md).

Servidor MCP que mostra **o que o seu app publicado entrega de graça para quem faz engenharia reversa**. MCPs de engenharia reversa deixam um agente explicar um app sem código-fonte até o nível binário; este pacote é o lado defensivo: aponte-o para os *seus próprios* artefatos de build e ele relata o que essas ferramentas (ou jadx, ILSpy, Hopper, DevTools do navegador) obtêm sem esforço, com uma correção para cada achado. Verifica bundles web e sites em produção (source maps, segredos), Electron (fuses, ASAR), Android APK/AAB, iOS IPA, Unity, PyInstaller, Java, Flutter, binários nativos (ELF, Mach-O, PE) e .NET. Tudo, exceto `scan_url`, roda localmente e offline. Cada resultado recebe uma nota de A a F.

> A telemetria vem **desativada** por padrão. Com `GUARDBEE_TELEMETRY=1`, são enviados o servidor, a ferramenta, o sucesso, a duração e valores curtos de parâmetros, como um caminho de arquivo; textos mais longos e campos como `content`, `token` ou `password` são substituídos por um marcador. Veja [`@guardbee/mcp-telemetry`](../telemetry/PT-BR.md).

## Instalação

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

## Ferramentas MCP

`scan_artifact`, `suggest_fixes`, `scan_url`, `list_checks`

Os detalhes estão em [README.md](README.md).

## Uso

```bash
npx @guardbee/mcp-reverse-shield scan ./dist --fail-on=high
npx @guardbee/mcp-reverse-shield scan ./app/build/outputs/apk/release/app-release.apk
npx @guardbee/mcp-reverse-shield scan https://app.example.com --format=sarif > reverse-shield.sarif
npx @guardbee/mcp-reverse-shield suggest . --format=patch | git apply
```

## Limites

A ofuscação é medida apenas pelos nomes, não pelo fluxo de controle. As verificações web só veem o que é publicado; não sabem se uma chave pode ser pública (por exemplo, uma chave web do Firebase restrita). `suggest_fixes` cobre as formas comuns de configuração: revise os diffs antes de aplicar.

Os detalhes estão em [README.md](README.md).

## Licença

MIT

## Feedback

Dúvidas, ideias ou um falso positivo? Abra um tópico no [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) ou [uma issue](https://github.com/GuardBee/guardbee-mcp/issues). Se o GuardBee for útil para você, uma ⭐ no [repositório](https://github.com/GuardBee/guardbee-mcp) ajuda outras pessoas a encontrá-lo.
