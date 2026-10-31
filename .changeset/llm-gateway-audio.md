---
"@guardbee/mcp-security-proxy": minor
---

LLM gateway: transcribe audio in requests (#239).

With `llm.documents.audio: { url, model, language?, apiKeyEnv? }`, Chat Completions `input_audio` parts (`wav`, `mp3`) are transcribed by your own OpenAI-compatible speech-to-text service (whisper.cpp server, faster-whisper-server, vLLM). The transcript goes through every prompt check, just like PDFs and images.

- Clean audio is forwarded unchanged.
- Audio in which personal data the proxy would mask is spoken is refused with `403` (`pii:document`).
- Audio that cannot be transcribed is `415 guardbee_unmaskable_content` while masking applies. This covers another format, wrong data, the service down or erroring, and the time limit.
- The audit log records the audio's size and hash, never the bytes or the transcript.
- Off by default: without `audio`, `input_audio` stays `415` as before.
