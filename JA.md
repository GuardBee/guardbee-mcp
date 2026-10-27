# guardbee-mcp

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | **🇯🇵 日本語** | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> これは短い概要です。完全なドキュメント（英語）は [README.md](README.md) をご覧ください。

GuardBee の MCP サーバー群です。AI エージェントとアプリケーションのセキュリティのための独立した npm パッケージが、ひとつのモノレポにまとまっています：シークレット、依存関係の CVE、TLS/DNS、プロンプトインジェクション、ツールポイズニング、MCP ゲートウェイなど。

## パッケージ

- [`@guardbee/mcp-a2a-auditor`](packages/a2a-auditor/JA.md) — Agent2Agent (A2A) プロトコルの実装コードを走査し、認証のないプッシュ通知 Webhook（SSRF）、認証要件のない Agent Card、公開される Agent Card に埋め込まれた認証情報を検出します。
- [`@guardbee/mcp-agent-graph-auditor`](packages/agent-graph-auditor/JA.md) — マルチエージェント構成（LangGraph、CrewAI、AutoGen/ag2）から到達可能性グラフを作り、自分では危険なツールを持たないのに委任やグループ経由でそれに到達できるエージェント（推移的な過剰権限）を見つけます。
- [`@guardbee/mcp-ai-code-scanner`](packages/ai-code-scanner/JA.md) — LLM/AI 統合の危険なパターンをコードから検出します：クライアントに露出した API キー、モデル出力の安全でない扱い、過剰なエージェント権限、外部 LLM への個人情報送信。
- [`@guardbee/mcp-audit-gap-auditor`](packages/audit-gap-auditor/JA.md) — MCP サーバーのソースを OWASP MCP08:2025（監査とテレメトリの欠如）の観点で検査します：ツール呼び出しのログ欠如、ログ内の生の引数や結果、無効化された監査、記録されずに握りつぶされるエラー。
- [`@guardbee/mcp-compliance-checker`](packages/compliance-checker/JA.md) — GuardBee API を通じて、Web サイトの KVKK・GDPR・CCPA への準拠を確認します。
- [`@guardbee/mcp-context-oversharing-auditor`](packages/context-oversharing-auditor/JA.md) — エージェント/MCP のソースを OWASP MCP10:2025（コンテキストの過剰共有）の観点で検査します：会話やメモリの丸ごと出力、ユーザー間で共有されるコンテキスト、ツール経由のシステムプロンプト漏えい、範囲指定のないベクトル検索。
- [`@guardbee/mcp-db-gateway`](packages/db-gateway/JA.md) — LLM とデータベースの間に入る KVKK/GDPR 準拠の MCP ゲートウェイです。個人情報のマスキング、ロールベースのアクセス制御、レート制限、監査ログを提供します。
- [`@guardbee/mcp-dependency-auditor`](packages/dependency-auditor/JA.md) — npm と pip のマニフェストを OSV データベースで照合し、既知の CVE を報告します。単一パッケージの照会は PyPI、crates.io、Maven、Go、RubyGems にも対応します。
- [`@guardbee/mcp-dns-intelligence`](packages/dns-intelligence/JA.md) — DNS レコードを列挙し、設定ミスやメールセキュリティ（SPF/DMARC）の不備、乗っ取り可能なダングリングサブドメインを検出します。
- [`@guardbee/mcp-elicitation-auditor`](packages/elicitation-auditor/JA.md) — MCP サーバーのコードで elicitation の危険なパターンを検出します：フォームでシークレットを求める、URL モードが第三者の認可エンドポイントを直接指す、URL に認証情報や個人情報を埋め込む。
- [`@guardbee/guard-core`](packages/guard-core/JA.md) — GuardBee パッケージが共有する検出器です：チェックサム検証付きの個人情報マスキング、シークレットとプロンプトインジェクションのルール、ツール分類、ゲートウェイのポリシースキーマ。
- [`@guardbee/mcp-llm-redteam`](packages/llm-redteam/JA.md) — 稼働中の LLM エンドポイントやチャットボットに、カナリアを使った脱獄・情報抽出・難読化のプローブを送り、既知の回避手法でガードレールが破られるかをテストします。
- [`@guardbee/mcp-config-auditor`](packages/mcp-config-auditor/JA.md) — インストール済みの MCP クライアント設定（Cursor、Claude Desktop、Windsurf、VS Code）とエージェントの SKILL.md を監査します：固定されていないパッケージ、シークレット、ワイルドカード自動承認、認証のないリモート、タイポスクワット、組織の許可リストに対する Shadow MCP（OWASP MCP09）。
- [`@guardbee/mcp-server-auditor`](packages/mcp-server-auditor/JA.md) — 他の MCP サーバーのツール定義を監査し、危険なパターンを見つけます：過剰な権限を示すツール名、生の入力が流れ込むシェル/eval/SQL/SSRF、緩すぎるスキーマ、ハードコードされたシークレット、ワイルドカード CORS。
- [`@guardbee/mcp-memory-poisoning-scanner`](packages/memory-poisoning-scanner/JA.md) — エージェントのコードでメモリ汚染のリスクを検出します：信頼できない入力が永続・セッション横断のメモリ（MemGPT 型のメモリや長期記憶としてのベクトルストア）に書き込まれ、後で信頼されたコンテキストとして呼び戻される箇所。
- [`@guardbee/mcp-model-scanner`](packages/model-scanner/JA.md) — ML モデルファイル（PyTorch、pickle、safetensors、Keras/H5、ONNX）のサプライチェーンリスクを検査します：悪意ある pickle ガジェット、偽装された safetensors ヘッダー、Keras Lambda 層による RCE、ONNX の外部データのパストラバーサル。
- [`@guardbee/mcp-oauth-auditor`](packages/oauth-auditor/JA.md) — MCP サーバー自身の認可コードを、MCP 仕様のセキュリティ考慮事項にある OAuth 2.1 の問題で検査します：トークンのパススルー、audience 検証の欠如、ディスカバリー経由の SSRF、PKCE の欠如、緩い redirect_uri 検証、ハードコードされたクライアントシークレット。
- [`@guardbee/mcp-owasp-scan`](packages/owasp-scan/JA.md) — OWASP MCP Top 10 の統合スキャナーです。ひとつの CLI/MCP がパスやライブの tools/list に対して GuardBee の監査ツールを実行し、結果を MCP01〜MCP10 に対応付けて A〜F で評価します。
- [`@guardbee/mcp-prompt-injection-scanner`](packages/prompt-injection-scanner/JA.md) — ドキュメント、スクレイピングしたページ、RAG コンテンツから間接プロンプトインジェクションを検出します：指示の上書き、偽装されたチャットテンプレートの役割、隠しテキスト、AI への直接の呼びかけ、データ持ち出しの試み。
- [`@guardbee/mcp-prompt-leak-scanner`](packages/prompt-leak-scanner/JA.md) — MCP サーバー兼リバースプロキシとして、LLM へ送られるプロンプトに含まれる認証情報や個人情報（API キー、TC Kimlik No、クレジットカード、IBAN）を、アプリケーションの外に出る前に捕捉します。
- [`@guardbee/mcp-rug-pull-detector`](packages/rug-pull-detector/JA.md) — 別の MCP サーバー（stdio または Streamable HTTP）に接続して tools/list の応答を基準として記録し、承認後にツールの説明・スキーマ・注釈がひそかに変わる「ラグプル」を検出します。
- [`@guardbee/mcp-secret-scanner`](packages/secret-scanner/JA.md) — ファイル、ディレクトリ、git 履歴、コーディングエージェントの会話記録から、漏えいしたシークレット・API キー・認証情報を検出します（76 種のルール、エントロピー検出、ベースライン、CLI での有効性確認）。
- [`@guardbee/mcp-security-proxy`](packages/security-proxy/JA.md) — MCP セキュリティゲートウェイです。複数の MCP サーバーをひとつのポリシーの背後に置き、有害なデータフロー（lethal trifecta）の遮断、承認、個人情報のマスキング、OIDC ユーザー、クォータ、OpenTelemetry、ハッシュチェーン監査ログを提供します。
- [`@guardbee/security-suite`](packages/security-suite/JA.md) — すべての GuardBee スキャナーと監査ツールを 1 回のインストールで：選んだグループのツールを提供する 1 つの MCP サーバーと、任意のパッケージを実行する CLI。
- [`@guardbee/mcp-slopsquat-scanner`](packages/slopsquat-scanner/JA.md) — package.json・requirements.txt・pyproject.toml の依存関係を実際の npm/PyPI レジストリと照合し、存在しない名前（LLM が幻覚した依存関係で、攻撃者が先に登録しうるもの＝スロップスクワッティング）とごく最近公開された名前を報告します。
- [`@guardbee/mcp-ssl-inspector`](packages/ssl-inspector/JA.md) — 任意のドメインの TLS 証明書・暗号スイート・プロトコル設定を検査します。追加のハンドシェイクで、サーバーがまだ受け入れる TLS 1.0/1.1、RSA 鍵交換、弱い DH や暗号を見つけます。
- [`@guardbee/mcp-telemetry`](packages/telemetry/JA.md) — GuardBee MCP サーバー共通の、オプトイン方式（デフォルト無効）の利用テレメトリクライアントです。
- [`@guardbee/mcp-threat-rules`](packages/threat-rules/JA.md) — Agent Threat Rules（ATR）への GuardBee MCP ブリッジです。プロンプトインジェクション、ツールポイズニング、コンテキスト持ち出し、MCP 攻撃のためのオープンな Sigma 風検出標準でエージェント/MCP のイベントを評価します。
- [`@guardbee/mcp-tool-poisoning-scanner`](packages/tool-poisoning-scanner/JA.md) — 他の MCP サーバーのツール定義で、ツールポイズニング（呼び出し側 LLM が信頼して読む説明文に隠された指示）と、読み取り専用をうたいながらシェルやファイル書き込みを行う「混乱した代理人」の不一致を検出します。
- [`@guardbee/mcp-toxic-flow-auditor`](packages/toxic-flow-auditor/JA.md) — MCP ツールカタログ全体で有害なデータフロー（lethal trifecta）を検出します：信頼できないコンテンツ、機密データ、外部送信や破壊的操作が同じサーバーにそろう組み合わせ。
- [`@guardbee/mcp-unbounded-consumption-auditor`](packages/unbounded-consumption-auditor/JA.md) — LLM/エージェントのコードで、OWASP LLM Top 10 2026 の 6 位「無制限な消費（denial of wallet）」のパターンを検出します：出力トークン上限の欠如、自前の LLM HTTP 呼び出しのタイムアウト欠如、無制限のツール呼び出しやリトライ、無効化された安全上限、レート制限のない MCP ツール。
- [`@guardbee/mcp-vector-store-scanner`](packages/vector-store-scanner/JA.md) — ベクトルデータベースのエンドポイント（Weaviate、Qdrant、Chroma、Elasticsearch/OpenSearch、Redis、Postgres/pgvector）を調べ、埋め込みや RAG データが認証なしで公開されていないかを確認します。
- [`@guardbee/mcp-vulnerability-scanner`](packages/vulnerability-scanner/JA.md) — GuardBee のセキュリティスキャンを起動して結果を照会し、AI による修正ガイダンスを提供します。

## ライセンス

MIT — [GuardBee](https://guardbee.ai)
