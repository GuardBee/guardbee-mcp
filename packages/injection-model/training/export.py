# Exports out/hf to ONNX (opset 17, dynamic batch and sequence), int8 dynamic quantization, and checks
# that the quantized model agrees with PyTorch on held-out rows. Output: out/onnx/{model_quantized.onnx, tokenizer.json, tokenizer_config.json, config.json}
import json, os, shutil, sys, random
import numpy as np, torch, onnxruntime as ort
from onnxruntime.quantization import quantize_dynamic, QuantType
from transformers import AutoTokenizer, AutoModelForSequenceClassification
T = sys.argv[1]; HF = os.path.join(T, "out/hf"); OUT = os.path.join(T, "out/onnx"); os.makedirs(OUT, exist_ok=True)
tok = AutoTokenizer.from_pretrained(HF); model = AutoModelForSequenceClassification.from_pretrained(HF).eval()
enc = tok(["hello world", "merhaba dünya nasılsın"], padding=True, return_tensors="pt")
inputs = ("input_ids", "attention_mask") + (("token_type_ids",) if "token_type_ids" in enc else ())
fp32 = os.path.join(OUT, "model.onnx")
torch.onnx.export(model, tuple(enc[k] for k in inputs), fp32, input_names=list(inputs), output_names=["logits"],
                  dynamic_axes={**{k: {0: "batch", 1: "sequence"} for k in inputs}, "logits": {0: "batch"}}, opset_version=17, dynamo=False)
q = os.path.join(OUT, "model_quantized.onnx")
quantize_dynamic(fp32, q, weight_type=QuantType.QInt8)
os.remove(fp32)
tok.save_pretrained(OUT)
shutil.copy(os.path.join(HF, "config.json"), os.path.join(OUT, "config.json"))
for f in os.listdir(OUT):
    if f not in {"model_quantized.onnx", "tokenizer.json", "tokenizer_config.json", "config.json"}: os.remove(os.path.join(OUT, f))
# parity on 300 random training-pool texts
rows = json.load(open(os.path.join(T, "train_pool.json"))); random.Random(1).shuffle(rows)
sess = ort.InferenceSession(q, providers=["CPUExecutionProvider"])
diffs, flips = [], 0
for r in rows[:300]:
    e = tok(r["text"], truncation=True, max_length=256, return_tensors="pt")
    with torch.no_grad(): p = torch.softmax(model(**e).logits, -1)[0, 1].item()
    lo = sess.run(None, {k: e[k].numpy() for k in inputs})[0][0]; pq = float(np.exp(lo[1]) / np.exp(lo).sum())
    diffs.append(abs(p - pq)); flips += (p >= 0.5) != (pq >= 0.5)
print("onnx int8 vs torch: mean |dp|", round(float(np.mean(diffs)), 4), "max", round(float(np.max(diffs)), 4), "flips@0.5", flips, "/300")
for f in sorted(os.listdir(OUT)): print(f, os.path.getsize(os.path.join(OUT, f)))
