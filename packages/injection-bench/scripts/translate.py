# EN→TR with Helsinki-NLP/opus-mt-tc-big-en-tr (CC BY 4.0), a translation-only model: it cannot follow
# the instructions it translates. Long texts are split into sentences and lines. Output: translated.jsonl
import json, os, re, sys, time
import torch
from transformers import MarianMTModel, MarianTokenizer
W, REV = sys.argv[1], sys.argv[2]
NAME = "Helsinki-NLP/opus-mt-tc-big-en-tr"
dev = "mps" if torch.backends.mps.is_available() else "cpu"
tok = MarianTokenizer.from_pretrained(NAME, revision=REV)
model = MarianMTModel.from_pretrained(NAME, revision=REV).to(dev).eval()
items = json.load(open(os.path.join(W, "to_translate.json")))

def pieces(text):
    out = []
    for line in text.split("\n"):
        if not line.strip(): out.append(""); continue
        # sentence split, keeping chunks under ~350 tokens
        for s in re.split(r"(?<=[.!?])\s+", line):
            while len(tok(s).input_ids) > 350:
                cut = s.rfind(" ", 0, len(s) // 2) or len(s) // 2
                out.append(s[:cut]); s = s[cut:].strip()
            out.append(s)
    return out

def translate(segments):
    todo = [s for s in segments if s.strip()]
    res = {}
    for i in range(0, len(todo), 16):
        batch = todo[i:i+16]
        enc = tok(batch, return_tensors="pt", padding=True, truncation=True, max_length=512).to(dev)
        with torch.no_grad():
            gen = model.generate(**enc, num_beams=4, max_new_tokens=512)
        for s, g in zip(batch, tok.batch_decode(gen, skip_special_tokens=True)): res[s] = g
    return res

out = open(os.path.join(W, "translated.jsonl"), "w")
t0 = time.time()
for n, it in enumerate(items):
    segs = pieces(it["text"])
    tr = translate(segs)
    # rebuild: sentences on a line joined by spaces, lines by newlines
    lines, cur = [], []
    joined = []
    for line in it["text"].split("\n"):
        ps = pieces(line) if line.strip() else [""]
        joined.append(" ".join(tr.get(p, p) for p in ps if p.strip()))
    out.write(json.dumps({**it, "tr": "\n".join(joined), "mt": f"{NAME}@{REV[:10]}"}, ensure_ascii=False) + "\n"); out.flush()
    if n % 50 == 0: print(n, len(items), f"{time.time()-t0:.0f}s", flush=True)
print("done", flush=True)
