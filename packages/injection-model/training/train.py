# Fine-tunes intfloat/multilingual-e5-small (MIT) as a binary injection classifier on train_pool.json + the Turkish
# translations in translated.jsonl. 10% held out (stratified by language and label) for early stopping and the
# threshold report. Saves the best checkpoint to out/hf.
import json, os, random, sys, time, math
import torch
from torch.utils.data import DataLoader
from transformers import AutoTokenizer, AutoModelForSequenceClassification, get_linear_schedule_with_warmup
T = sys.argv[1]; BASE = "intfloat/multilingual-e5-small"; REV = "614241f622f53c4eeff9890bdc4f31cfecc418b3"
torch.manual_seed(231); rng = random.Random(231)
rows = json.load(open(os.path.join(T, "train_pool.json")))
for l in open(os.path.join(T, "translated.jsonl")):
    r = json.loads(l); tr = r["tr"].strip(); ratio = len(tr) / max(1, len(r["text"]))
    if tr and 0.5 <= ratio <= 2.0: rows.append({"text": tr, "label": 1 if r["label"] == "attack" else 0, "lang": "tr", "source": r["source"] + "-mt"})
rng.shuffle(rows)
val, train = [], []
seen = {}
for r in rows:
    k = (r["lang"], r["label"]); seen[k] = seen.get(k, 0) + 1
    (val if seen[k] % 10 == 0 else train).append(r)
print("train", len(train), "val", len(val), flush=True)
dev = os.environ.get("TRAIN_DEVICE", "cpu")
tok = AutoTokenizer.from_pretrained(BASE, revision=REV)
model = AutoModelForSequenceClassification.from_pretrained(BASE, revision=REV, num_labels=2, id2label={0: "SAFE", 1: "INJECTION"}, label2id={"SAFE": 0, "INJECTION": 1}).to(dev)
MAXLEN = 256
def collate(batch):
    enc = tok([b["text"] for b in batch], truncation=True, max_length=MAXLEN, padding=True, return_tensors="pt")
    enc["labels"] = torch.tensor([b["label"] for b in batch]); return enc
# length-bucketed batches for speed
def batches(data, bs, shuffle):
    idx = sorted(range(len(data)), key=lambda i: len(data[i]["text"]))
    chunks = [idx[i:i + bs] for i in range(0, len(idx), bs)]
    if shuffle: rng.shuffle(chunks)
    return [[data[i] for i in c] for c in chunks]
EPOCHS, BS, LR = 4, 32, 5e-5
opt = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=0.01)
steps = EPOCHS * math.ceil(len(train) / BS)
sched = get_linear_schedule_with_warmup(opt, int(0.06 * steps), steps)
def evaluate():
    model.eval(); scores = []
    with torch.no_grad():
        for b in batches(val, 32, False):
            enc = collate(b).to(dev); labels = enc.pop("labels")
            p = torch.softmax(model(**enc).logits.float(), -1)[:, 1].cpu().tolist()
            scores += [(s, x["label"], x["lang"]) for s, x in zip(p, b)]
    model.train()
    def f1(th, lang=None):
        tp = sum(1 for s, y, l in scores if (lang is None or l == lang) and y == 1 and s >= th)
        fp = sum(1 for s, y, l in scores if (lang is None or l == lang) and y == 0 and s >= th)
        fn = sum(1 for s, y, l in scores if (lang is None or l == lang) and y == 1 and s < th)
        return 2 * tp / max(1, 2 * tp + fp + fn), fp / max(1, sum(1 for s, y, l in scores if (lang is None or l == lang) and y == 0))
    return {f"{lang or 'all'}@{th}": f1(th, lang) for lang in [None, "en", "tr"] for th in [0.5, 0.8, 0.95]}
best, step, t0 = -1, 0, time.time()
model.train()
for epoch in range(EPOCHS):
    for b in batches(train, BS, True):
        enc = collate(b).to(dev)
        loss = model(**enc).loss
        loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step(); sched.step(); opt.zero_grad(); step += 1
        if step % 100 == 0: print(f"epoch {epoch} step {step}/{steps} loss {loss.item():.4f} {time.time()-t0:.0f}s", flush=True)
    m = evaluate(); print("val", epoch, json.dumps({k: [round(v[0], 4), round(v[1], 4)] for k, v in m.items()}), flush=True)
    if m["all@0.5"][0] > best:
        best = m["all@0.5"][0]; model.save_pretrained(os.path.join(T, "out/hf")); tok.save_pretrained(os.path.join(T, "out/hf"))
        print("saved", best, flush=True)
json.dump({"base": BASE, "revision": REV, "train": len(train), "val": len(val), "epochs": EPOCHS, "lr": LR, "maxlen": MAXLEN, "best_val_f1": best}, open(os.path.join(T, "out/train_meta.json"), "w"))
print("done", flush=True)
