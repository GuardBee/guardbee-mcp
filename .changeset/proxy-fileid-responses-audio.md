---
"@guardbee/mcp-security-proxy": minor
---

LLM gateway: OpenAI-compatible `file_id` PDFs are downloaded from the routed provider Files API when `llm.documents.pdf` is on; Responses `input_audio` is transcribed like Chat Completions when `llm.documents.audio` is set. Realtime WebSocket audio stays out of scope.
