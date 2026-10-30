---
"@guardbee/mcp-security-proxy": minor
---

LLM gateway: read images in requests with OCR (#239).

With `llm.documents.images: true`, inline images are read with Tesseract OCR (`tesseract.js`, installed next to the proxy) and their text goes through every prompt check, just like PDFs: injection, credentials, topic rules, sensitive routing and PII. This covers OpenAI `image_url` parts, Responses `input_image` parts and Anthropic base64 `image` blocks.

- A clean image is forwarded unchanged.
- An image holding personal data the proxy would mask is refused with `403` (`pii:document`).
- An image that cannot be read (OCR not installed, not an image, size, timeout) is `415 guardbee_unmaskable_content` while masking applies.
- New options: `llm.documents.languages` (default `[tur, eng]`) and `llm.documents.langPath` for offline language data.
- Images given by URL are not fetched and pass as before. Off by default: without `images: true`, images are forwarded unchecked as before.
