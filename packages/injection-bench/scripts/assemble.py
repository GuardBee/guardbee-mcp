# Builds data/en.jsonl and data/tr.jsonl from: en_public.json (select.py), translated.jsonl (translate.py),
# raw/oasst2_tr.json (native Turkish prompts from OpenAssistant/oasst2) and handwritten.json (handwritten.py).
import hashlib, json, os, re, sys
from collections import defaultdict, Counter
W, OUT = sys.argv[1], sys.argv[2]
load = lambda f: json.load(open(os.path.join(W, f)))
rows = []
for r in load("en_public.json"):
    rows.append({"lang": "en", **r})
dropped = Counter()
for line in open(os.path.join(W, "translated.jsonl")):
    r = json.loads(line)
    src, tr = r["text"], r["tr"].strip()
    ratio = len(tr) / max(1, len(src))
    if not tr or tr == src or ratio < 0.5 or ratio > 2.0:
        dropped["length/empty"] += 1; continue
    # repeated-token degeneration of the MT model
    if re.search(r"(\b\w+\b)(?:\W+\1\b){5,}", tr, re.I):
        dropped["degenerate"] += 1; continue
    rows.append({"lang": "tr", "label": r["label"], "technique": r["technique"], "source": r["source"], "text": tr,
                 "translation": {"from": "en", "model": r["mt"]}})
for t in load("raw/oasst2_tr.json"):
    t = t.strip()
    if 8 <= len(t) <= 4000:
        rows.append({"lang": "tr", "label": "benign", "technique": "ordinary_request", "source": "OpenAssistant/oasst2", "text": t})
for r in load("handwritten.json"):
    rows.append(r)

# de-duplicate within a language
seen, uniq = set(), []
for r in rows:
    k = (r["lang"], re.sub(r"\s+", " ", r["text"]).strip().lower())
    if k in seen: dropped["duplicate"] += 1; continue
    seen.add(k); uniq.append(r)

# split: within each (lang, source, technique, label) group, ordered by content hash, alternate dev/test
groups = defaultdict(list)
for r in uniq: groups[(r["lang"], r["source"], r["technique"], r["label"])].append(r)
for g in groups.values():
    g.sort(key=lambda r: hashlib.sha256(r["text"].encode()).hexdigest())
    for i, r in enumerate(g): r["split"] = "dev" if i % 2 == 0 else "test"

os.makedirs(OUT, exist_ok=True)
for lang in ["en", "tr"]:
    sel = sorted((r for r in uniq if r["lang"] == lang), key=lambda r: (r["label"], r["source"], r["technique"], hashlib.sha256(r["text"].encode()).hexdigest()))
    counter = Counter()
    with open(os.path.join(OUT, f"{lang}.jsonl"), "w") as f:
        for r in sel:
            counter[r["label"]] += 1
            row = {"id": f"{lang}-{r['label'][0]}{counter[r['label']]:04d}", "lang": lang, "split": r["split"], "label": r["label"],
                   "technique": r["technique"], "source": r["source"], "text": r["text"]}
            if "translation" in r: row["translation"] = r["translation"]
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(lang, dict(counter), dict(Counter((r["label"], r["split"]) for r in sel)))
print("dropped", dict(dropped))
