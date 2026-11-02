---
"@guardbee/mcp-reverse-shield": patch
---

Web scans no longer report a JWT as a leaked credential when it is the signed token of a media URL (`master.m3u8?token=eyJ…`, `image.jpg?token=…`) handed to every visitor, or when its `exp` has already passed. Live tokens elsewhere in a bundle are still reported.
