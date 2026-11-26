# @guardbee/mcp-document-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | **🇰🇷 한국어** | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> 이 문서는 짧은 요약입니다. 전체 문서(영어)는 [README.md](README.md)를 참고하세요.

PDF, 스크린샷, 스캔 문서 안의 **개인정보와 자격 증명**을 LLM에 전달되기 전에 찾아내는 MCP 서버이자 CLI입니다. 먼저 PDF 텍스트 레이어를 읽고, 텍스트가 없는 페이지와 이미지는 OCR(튀르키예어·영어)로 읽습니다. TC Kimlik 번호, VKN, IBAN, 카드(체크섬 검증), 여권, SGK, MERSİS, 생년월일, 주소, 이메일, KEP, 전화번호와 22가지 이상의 자격 증명 형식을 탐지합니다. 결과에는 값의 첫 글자와 마지막 글자만 표시됩니다.

> 텔레메트리는 기본적으로 **꺼져** 있습니다. `GUARDBEE_TELEMETRY=1`을 설정하면 서버, 도구, 성공 여부, 소요 시간, 파일 경로 같은 짧은 파라미터 값이 전송되며, 더 긴 문자열과 `content`, `token`, `password` 같은 필드는 플레이스홀더로 대체됩니다. [`@guardbee/mcp-telemetry`](../telemetry/KO.md) 참고.

## 설치

```bash
npx -y @guardbee/mcp-document-scanner scan ./contracts
npm i -g @guardbee/mcp-document-scanner tesseract.js @napi-rs/canvas   # + OCR
```

## MCP 도구

`scan_document`, `scan_base64`, `list_detectors`

자세한 내용은 [README.md](README.md)에 있습니다.

## 사용법

```bash
guardbee-document-scanner scan <file|folder> [--format=text|json|sarif] [--fail-on=...] [--no-ocr] [--lang=tur,eng]
```

[`@guardbee/mcp-security-proxy`](../security-proxy)의 `interceptors.documents`가 이 패키지를 사용해, 도구 결과 속 이미지와 내장 PDF를 모델이 보기 전에 검사합니다.

## 라이선스

MIT

## 피드백

질문, 아이디어, 오탐이 있나요? [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions)에 글을 남기거나 [이슈를 열어](https://github.com/GuardBee/guardbee-mcp/issues) 주세요. GuardBee가 도움이 되었다면 [저장소](https://github.com/GuardBee/guardbee-mcp)에 ⭐를 눌러 다른 사람도 찾을 수 있게 해 주세요.
