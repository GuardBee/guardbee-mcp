# @guardbee/mcp-document-scanner

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md)

An MCP server and CLI that finds **personal data and credentials inside documents** — PDFs, screenshots, scanned pages — before they are handed to an LLM. Text checks in a proxy or a DLP see a PDF attachment or an image as an opaque blob; this package reads it: the PDF text layer first, and OCR (Turkish and English) for images and for PDF pages that have no text.

> This package sends usage telemetry by default (tool name + short parameters; document contents and findings are never included — see [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Disable with `GUARDBEE_TELEMETRY=0`.

```
document ──► type from the bytes (PDF, PNG, JPEG, GIF, WebP, BMP, TIFF, text)
              │
              ├─ PDF page with a text layer ──► text
              ├─ PDF page without one ─────► render (@napi-rs/canvas) ──► OCR (tesseract.js)
              └─ image ─────────────────────► OCR (tesseract.js)
                                                 │
                     guard-core detectors ◄──────┘  TC Kimlik No, VKN, IBAN, card (checksums),
                                                    passport, SGK, MERSİS, birth date, address,
                                                    e-mail, KEP, phone, 22+ credential formats
```

## Install

```bash
npx -y @guardbee/mcp-document-scanner scan ./contracts      # text layers only
npm i -g @guardbee/mcp-document-scanner tesseract.js @napi-rs/canvas   # with OCR
```

OCR is optional: `tesseract.js` reads images, and `@napi-rs/canvas` (prebuilt, no compiler needed) renders scanned PDF pages for it. Without them the scanner still reads every PDF text layer and says which pages or images it could not read. Tesseract downloads the `tur` and `eng` language data (~10 MB) on first use into `~/.cache/guardbee/tessdata` (or `$XDG_CACHE_HOME/guardbee/tessdata`) — never into your working directory. Offline: put `<lang>.traineddata` in a folder and pass `--lang-path`.

## MCP tools

| Tool | What it does |
|---|---|
| `scan_document` | Scan a file, or every PDF and image in a folder |
| `scan_base64` | Scan bytes given as base64 (an attachment, an image a tool returned); the type comes from the bytes |
| `list_detectors` | The personal-data and credential detectors that run |

```json
{ "mcpServers": { "documents": { "command": "npx", "args": ["-y", "@guardbee/mcp-document-scanner"] } } }
```

## CLI

```bash
guardbee-document-scanner scan <file|folder> [--format=text|json|sarif] [--fail-on=any|critical|high|medium|low|none]
                               [--no-ocr] [--lang=tur,eng] [--lang-path=<dir>] [--include=ip_address,plate_tr]
                               [--max-pages=50] [--max-files=500] [--text]
```

```
⚠️  Found 3 item(s) in 1 document(s) (812ms)
   Critical: 0  High: 2  Medium: 1  Low: 0

contracts/acme.pdf (pdf, 2 page(s) read)
  [HIGH] tc_kimlik (personal) — page 1, pdf-text: 10*******46
  [HIGH] iban (personal) — page 2, pdf-ocr: TR************26
  [MEDIUM] email (personal) — page 2, pdf-ocr: al***********om
```

Findings show only the first and last characters. `--format=sarif` gives SARIF 2.1.0 with the page as the line, for GitHub Code Scanning. Exit code 1 when something at or above `--fail-on` was found.

## In the security proxy

[`@guardbee/mcp-security-proxy`](../security-proxy) uses this package for `interceptors.documents`: images and embedded PDFs in tool results and resource blobs are scanned before the model sees them, and a document holding personal data or a credential is withheld (`block`) or logged (`warn`).

```yaml
interceptors:
  documents: { enabled: true, action: block, ocr: true, maxBytes: 26214400 }
```

## Limits

- The type is taken from the bytes, never from a file name or a MIME type.
- 25 MB and 50 pages per document by default (`maxBytes`, `--max-pages`).
- OCR quality depends on the scan; a blurry photo can miss a digit and so fail a checksum — such a value is not reported, which errs towards silence rather than false alarms.
- Names, signatures and handwriting are not detected.

## License

MIT
