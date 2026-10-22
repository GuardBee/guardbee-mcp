# guardbee-mcp

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | **🇰🇷 한국어** | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> 이 문서는 짧은 요약입니다. 전체 문서(영어)는 [README.md](README.md)를 참고하세요.

GuardBee의 MCP 서버 모음입니다. AI 에이전트와 애플리케이션 보안을 위한 독립적인 npm 패키지들이 하나의 모노레포에 있습니다: 시크릿, 의존성 CVE, TLS/DNS, 프롬프트 인젝션, 도구 포이즈닝, MCP 게이트웨이 등.

## 패키지

- [`@guardbee/mcp-a2a-auditor`](packages/a2a-auditor/KO.md) — Agent2Agent(A2A) 프로토콜 구현 코드를 검사해 인증 없는 푸시 알림 웹훅(SSRF), 인증 요구가 없는 Agent Card, 공개 Agent Card에 포함된 자격 증명을 찾아냅니다.
- [`@guardbee/mcp-agent-graph-auditor`](packages/agent-graph-auditor/KO.md) — 멀티 에이전트 구성(LangGraph, CrewAI, AutoGen/ag2)으로 도달 가능성 그래프를 만들어, 위험한 도구를 직접 갖지 않았지만 위임이나 그룹을 통해 도달할 수 있는 에이전트(전이적 과도 권한)를 찾습니다.
- [`@guardbee/mcp-ai-code-scanner`](packages/ai-code-scanner/KO.md) — 코드에서 위험한 LLM/AI 통합 패턴을 찾습니다: 클라이언트에 노출된 API 키, 모델 출력의 안전하지 않은 처리, 과도한 에이전트 권한, 외부 LLM으로 전송되는 개인정보.
- [`@guardbee/mcp-audit-gap-auditor`](packages/audit-gap-auditor/KO.md) — MCP 서버 소스를 OWASP MCP08:2025(감사 및 원격 측정 부재) 관점에서 검사합니다: 도구 호출 로그 누락, 로그에 남는 원본 인자·결과, 비활성화된 감사, 기록 없이 삼켜지는 오류.
- [`@guardbee/mcp-compliance-checker`](packages/compliance-checker/KO.md) — GuardBee API를 통해 웹사이트의 KVKK, GDPR, CCPA 준수 여부를 확인합니다.
- [`@guardbee/mcp-context-oversharing-auditor`](packages/context-oversharing-auditor/KO.md) — 에이전트/MCP 소스를 OWASP MCP10:2025(컨텍스트 과다 공유) 관점에서 검사합니다: 대화·메모리 전체 덤프, 사용자 간 공유 컨텍스트, 도구를 통한 시스템 프롬프트 유출, 범위 제한 없는 벡터 검색.
- [`@guardbee/mcp-db-gateway`](packages/db-gateway/KO.md) — LLM과 데이터베이스 사이에 두는 KVKK/GDPR 준수 MCP 게이트웨이입니다. 개인정보 마스킹, 역할 기반 접근 제어, 속도 제한, 감사 로그를 제공합니다.
- [`@guardbee/mcp-dependency-auditor`](packages/dependency-auditor/KO.md) — npm과 pip 매니페스트를 OSV 데이터베이스와 대조해 알려진 CVE를 보고합니다. 단일 패키지 조회는 PyPI, crates.io, Maven, Go, RubyGems도 지원합니다.
- [`@guardbee/mcp-dns-intelligence`](packages/dns-intelligence/KO.md) — DNS 레코드를 열거하고 설정 오류, 이메일 보안(SPF/DMARC) 미비, 탈취 가능한 댕글링 서브도메인을 찾습니다.
- [`@guardbee/mcp-elicitation-auditor`](packages/elicitation-auditor/KO.md) — MCP 서버 코드에서 위험한 elicitation 패턴을 찾습니다: 폼으로 시크릿 요청, URL 모드가 제3자 인증 엔드포인트를 직접 가리킴, URL에 자격 증명이나 개인정보 포함.
- [`@guardbee/guard-core`](packages/guard-core/KO.md) — GuardBee 패키지가 공유하는 탐지기입니다: 체크섬 검증 개인정보 마스킹, 시크릿·프롬프트 인젝션 규칙, 도구 분류, 게이트웨이 정책 스키마.
- [`@guardbee/mcp-llm-redteam`](packages/llm-redteam/KO.md) — 운영 중인 LLM 엔드포인트나 챗봇에 카나리아 기반 탈옥·추출·난독화 프로브를 보내, 알려진 우회 기법으로 가드레일이 뚫리는지 테스트합니다.
- [`@guardbee/mcp-config-auditor`](packages/mcp-config-auditor/KO.md) — 설치된 MCP 클라이언트 설정(Cursor, Claude Desktop, Windsurf, VS Code)과 에이전트 SKILL.md를 감사합니다: 고정되지 않은 패키지, 시크릿, 와일드카드 자동 승인, 인증 없는 원격 서버, 타이포스쿼팅, 조직 허용 목록 대비 Shadow MCP(OWASP MCP09).
- [`@guardbee/mcp-server-auditor`](packages/mcp-server-auditor/KO.md) — 다른 MCP 서버의 도구 정의를 감사해 위험한 패턴을 찾습니다: 과도한 권한의 도구 이름, 원본 입력이 흘러드는 셸/eval/SQL/SSRF, 지나치게 느슨한 스키마, 하드코딩된 시크릿, 와일드카드 CORS.
- [`@guardbee/mcp-memory-poisoning-scanner`](packages/memory-poisoning-scanner/KO.md) — 에이전트 코드에서 메모리 오염 위험을 찾습니다: 신뢰할 수 없는 입력이 영구·세션 간 메모리(MemGPT형 메모리나 장기 기억용 벡터 스토어)에 기록되었다가 나중에 신뢰된 컨텍스트로 다시 불려오는 곳.
- [`@guardbee/mcp-model-scanner`](packages/model-scanner/KO.md) — ML 모델 파일(PyTorch, pickle, safetensors, Keras/H5, ONNX)의 공급망 위험을 검사합니다: 악성 pickle 가젯, 위장된 safetensors 헤더, Keras Lambda 레이어 RCE, ONNX 외부 데이터 경로 조작.
- [`@guardbee/mcp-oauth-auditor`](packages/oauth-auditor/KO.md) — MCP 서버 자체의 인가 코드를 MCP 사양 보안 고려사항의 OAuth 2.1 문제로 검사합니다: 토큰 패스스루, audience 검증 누락, 디스커버리를 통한 SSRF, PKCE 누락, 느슨한 redirect_uri 검증, 하드코딩된 클라이언트 시크릿.
- [`@guardbee/mcp-owasp-scan`](packages/owasp-scan/KO.md) — OWASP MCP Top 10 통합 스캐너입니다. 하나의 CLI/MCP가 경로나 라이브 tools/list에 GuardBee 감사 도구를 실행하고, 결과를 MCP01~MCP10에 매핑해 A~F 등급을 매깁니다.
- [`@guardbee/mcp-prompt-injection-scanner`](packages/prompt-injection-scanner/KO.md) — 문서, 스크래핑한 페이지, RAG 콘텐츠에서 간접 프롬프트 인젝션을 찾습니다: 지시 덮어쓰기, 위조된 채팅 템플릿 역할, 숨은 텍스트, AI를 직접 부르는 내용, 데이터 유출 시도.
- [`@guardbee/mcp-prompt-leak-scanner`](packages/prompt-leak-scanner/KO.md) — MCP 서버이자 리버스 프록시로서, LLM으로 나가는 프롬프트 속 자격 증명과 개인정보(API 키, TC Kimlik No, 신용카드, IBAN)를 애플리케이션을 떠나기 전에 잡아냅니다.
- [`@guardbee/mcp-rug-pull-detector`](packages/rug-pull-detector/KO.md) — 다른 MCP 서버(stdio 또는 Streamable HTTP)에 연결해 tools/list 응답을 기준선으로 저장하고, 승인 후 도구 설명·스키마·주석이 몰래 바뀌는 '러그 풀'을 탐지합니다.
- [`@guardbee/mcp-secret-scanner`](packages/secret-scanner/KO.md) — 파일, 디렉터리, git 기록, 코딩 에이전트 대화 기록에서 노출된 시크릿·API 키·자격 증명을 찾습니다(76개 규칙, 엔트로피 탐지, 베이스라인, CLI 유효성 확인).
- [`@guardbee/mcp-security-proxy`](packages/security-proxy/KO.md) — MCP 보안 게이트웨이입니다. 여러 MCP 서버를 하나의 정책 뒤에 두고, 유해 데이터 흐름(lethal trifecta) 차단, 승인, 개인정보 마스킹, OIDC 사용자, 할당량, OpenTelemetry, 해시 체인 감사 로그를 제공합니다.
- [`@guardbee/security-suite`](packages/security-suite/KO.md) — 주요 GuardBee 보안 도구를 하나의 패키지로 묶었습니다: 시크릿 스캐너, 의존성 감사, SSL 검사기, DNS 인텔리전스.
- [`@guardbee/mcp-slopsquat-scanner`](packages/slopsquat-scanner/KO.md) — package.json, requirements.txt, pyproject.toml의 의존성을 실제 npm/PyPI 레지스트리와 대조해, 존재하지 않는 이름(LLM이 환각한 의존성으로 공격자가 먼저 등록할 수 있는 것, 즉 슬롭스쿼팅)과 아주 최근에 게시된 이름을 보고합니다.
- [`@guardbee/mcp-ssl-inspector`](packages/ssl-inspector/KO.md) — 모든 도메인의 TLS 인증서, 암호 스위트, 프로토콜 설정을 검사합니다. 추가 핸드셰이크로 서버가 아직 허용하는 TLS 1.0/1.1, RSA 키 교환, 약한 DH와 암호를 찾습니다.
- [`@guardbee/mcp-telemetry`](packages/telemetry/KO.md) — GuardBee MCP 서버가 공유하는, 옵트인 방식(기본값 꺼짐)의 사용 원격 측정 클라이언트입니다.
- [`@guardbee/mcp-threat-rules`](packages/threat-rules/KO.md) — Agent Threat Rules(ATR)에 대한 GuardBee MCP 브리지입니다. 프롬프트 인젝션, 도구 포이즈닝, 컨텍스트 유출, MCP 공격을 위한 개방형 Sigma 스타일 탐지 표준으로 에이전트/MCP 이벤트를 평가합니다.
- [`@guardbee/mcp-tool-poisoning-scanner`](packages/tool-poisoning-scanner/KO.md) — 다른 MCP 서버의 도구 정의에서 도구 포이즈닝(호출하는 LLM이 신뢰하고 읽는 설명에 숨긴 지시)과, 읽기 전용이라면서 셸이나 파일 쓰기를 하는 '혼동된 대리인' 불일치를 찾습니다.
- [`@guardbee/mcp-toxic-flow-auditor`](packages/toxic-flow-auditor/KO.md) — MCP 도구 카탈로그 전체에서 유해 데이터 흐름(lethal trifecta)을 찾습니다: 신뢰할 수 없는 콘텐츠, 민감한 데이터, 외부 전송이나 파괴적 작업이 같은 서버에 함께 있는 조합.
- [`@guardbee/mcp-unbounded-consumption-auditor`](packages/unbounded-consumption-auditor/KO.md) — LLM/에이전트 코드에서 OWASP LLM Top 10 2026의 6위 '무제한 소비(denial of wallet)' 패턴을 찾습니다: 출력 토큰 제한 누락, 직접 만든 LLM HTTP 호출의 타임아웃 누락, 무제한 도구 호출·재시도 루프, 비활성화된 안전 한도, 속도 제한 없는 MCP 도구.
- [`@guardbee/mcp-vector-store-scanner`](packages/vector-store-scanner/KO.md) — 벡터 데이터베이스 엔드포인트(Weaviate, Qdrant, Chroma, Elasticsearch/OpenSearch, Redis, Postgres/pgvector)를 점검해 임베딩과 RAG 데이터가 인증 없이 노출되어 있는지 확인합니다.
- [`@guardbee/mcp-vulnerability-scanner`](packages/vulnerability-scanner/KO.md) — GuardBee 보안 스캔을 실행하고 결과를 조회하며, AI 기반 수정 가이드를 제공합니다.

## 라이선스

MIT — [GuardBee](https://guardbee.ai)
