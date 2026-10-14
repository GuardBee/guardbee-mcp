---
"@guardbee/guard-core": minor
"@guardbee/mcp-security-proxy": minor
---

`interceptors.documents` (off by default): images, embedded PDFs and resource blobs in tool results and resource reads are scanned for PII and credentials with the new `@guardbee/mcp-document-scanner` (PDF text layer, optional OCR) and withheld (`block`) or logged (`warn`). The shared policy schema accepts the new interceptor.
