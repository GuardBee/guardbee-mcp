---
"@guardbee/mcp-document-scanner": patch
"@guardbee/ner": patch
---

Add a `default` export condition so the CommonJS build of `@guardbee/mcp-security-proxy` can load these packages. Without it, `require()` failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`, and `interceptors.documents` threw on every tool call in the published proxy. Needs Node 20.19+ or 22.12+ (require of an ES module).
