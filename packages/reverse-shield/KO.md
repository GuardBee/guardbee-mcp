# @guardbee/mcp-reverse-shield

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | **🇰🇷 한국어** | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> 이 문서는 짧은 요약입니다. 전체 문서(영어)는 [README.md](README.md)를 참고하세요.

**배포한 앱이 리버스 엔지니어에게 무엇을 공짜로 넘겨주는지** 알려 주는 MCP 서버입니다. 리버스 엔지니어링 MCP를 쓰면 에이전트가 소스 없는 앱을 바이너리 수준까지 설명할 수 있는데, 이 패키지는 그 반대편입니다. *자신의* 빌드 산출물을 지정하면 그런 도구(또는 jadx, ILSpy, Hopper, 브라우저 DevTools)가 손쉽게 얻을 수 있는 것을 항목별 수정 방법과 함께 보고합니다. 웹 번들과 운영 사이트(소스 맵, 시크릿), Electron(fuse, ASAR), Android APK/AAB, iOS IPA, Unity, PyInstaller, Java, Flutter, 네이티브 바이너리(ELF, Mach-O, PE), .NET을 검사합니다. `scan_url`을 제외한 모든 검사는 로컬·오프라인으로 실행되며, 결과마다 A–F 등급이 붙습니다.

> 텔레메트리는 기본적으로 **꺼져** 있습니다. `GUARDBEE_TELEMETRY=1`을 설정하면 서버, 도구, 성공 여부, 소요 시간, 파일 경로 같은 짧은 파라미터 값이 전송되며, 더 긴 문자열과 `content`, `token`, `password` 같은 필드는 플레이스홀더로 대체됩니다. [`@guardbee/mcp-telemetry`](../telemetry/KO.md) 참고.

## 설치

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

## MCP 도구

`scan_artifact`, `suggest_fixes`, `scan_url`, `list_checks`

자세한 내용은 [README.md](README.md)에 있습니다.

## 사용법

```bash
npx @guardbee/mcp-reverse-shield scan ./dist --fail-on=high
npx @guardbee/mcp-reverse-shield scan ./app/build/outputs/apk/release/app-release.apk
npx @guardbee/mcp-reverse-shield scan https://app.example.com --format=sarif > reverse-shield.sarif
npx @guardbee/mcp-reverse-shield suggest . --format=patch | git apply
```

## 제한

난독화는 이름으로만 판단하며 제어 흐름은 분석하지 않습니다. 웹 검사는 배포된 내용만 보므로 키가 공개되어도 되는지(예: 제한된 Firebase 웹 키)는 판단할 수 없습니다. `suggest_fixes`는 일반적인 설정 형태만 다루므로 적용 전에 diff를 검토하세요.

자세한 내용은 [README.md](README.md)에 있습니다.

## 라이선스

MIT

## 피드백

질문, 아이디어, 오탐이 있나요? [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions)에 글을 남기거나 [이슈를 열어](https://github.com/GuardBee/guardbee-mcp/issues) 주세요. GuardBee가 도움이 되었다면 [저장소](https://github.com/GuardBee/guardbee-mcp)에 ⭐를 눌러 다른 사람도 찾을 수 있게 해 주세요.
