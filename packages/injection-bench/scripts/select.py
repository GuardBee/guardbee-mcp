# Deterministic selection of the English set and a disjoint pool to translate into Turkish.
import json, re, random, hashlib, os, sys
W = sys.argv[1]; R = os.path.join(W, "raw")
load = lambda f: json.load(open(os.path.join(R, f)))
rng = random.Random(20261031)
de = re.compile(r"\b(und|nicht|ich|die|der|das|ist|Sie|wie|was|mir|bitte|vergiss|alle|ein|eine|zu|auf|für|mit)\b")
norm = lambda t: re.sub(r"\s+", " ", t).strip()

gandalf = [norm(x["text"]) for s in ["train", "validation", "test"] for x in load(f"gandalf_{s}.json")]
deep = [(norm(x["text"]), x["label"]) for s in ["train", "test"] for x in load(f"deepset_{s}.json") if not de.search(x["text"])]
jack = [(norm(x["prompt"]), x["type"]) for s in ["train", "test"] for x in load(f"jackhhao_{s}.json")]
def uniq(xs):
    seen, out = set(), []
    for x in xs:
        k = (x if isinstance(x, str) else x[0]).lower()
        if k not in seen and len(k) >= 8: seen.add(k); out.append(x)
    return out
gandalf, deep, jack = uniq(gandalf), uniq(deep), uniq(jack)
rng.shuffle(gandalf); rng.shuffle(deep); rng.shuffle(jack)
jail = [t for t, y in jack if y == "jailbreak"]; jben = [t for t, y in jack if y == "benign"]
dinj = [t for t, y in deep if y == 1]; dben = [t for t, y in deep if y == 0]
short = lambda xs: [t for t in xs if len(t) <= 1200]

def row(text, label, source, technique):
    return {"text": text, "label": label, "source": source, "technique": technique}
en = (
    [row(t, "attack", "Lakera/gandalf_ignore_instructions", "direct_override") for t in gandalf[:300]]
    + [row(t, "attack", "jackhhao/jailbreak-classification", "jailbreak") for t in jail[:200]]
    + [row(t, "attack", "deepset/prompt-injections", "direct_override") for t in dinj]
    + [row(t, "benign", "jackhhao/jailbreak-classification", "roleplay_benign") for t in jben[:300]]
    + [row(t, "benign", "deepset/prompt-injections", "ordinary_request") for t in dben]
)
used = {r["text"] for r in en}
jail_tr = [t for t in short(jail[200:]) if t not in used][:170]
jben_tr = [t for t in jben[300:] if t not in used and len(t) <= 2500]
to_tr = (
    [row(t, "attack", "Lakera/gandalf_ignore_instructions", "direct_override") for t in gandalf[300:640]]
    + [row(t, "attack", "jackhhao/jailbreak-classification", "jailbreak") for t in jail_tr]
    + [row(t, "benign", "jackhhao/jailbreak-classification", "roleplay_benign") for t in jben_tr]
)
# deepset benign is all used in English; top up the Turkish benign pool from its remaining rows if any
json.dump(en, open(os.path.join(W, "en_public.json"), "w"), ensure_ascii=False, indent=0)
json.dump(to_tr, open(os.path.join(W, "to_translate.json"), "w"), ensure_ascii=False, indent=0)
from collections import Counter
print("en", Counter(r["label"] for r in en), "to_tr", Counter(r["label"] for r in to_tr), "jail_tr", len(jail_tr), "jben_tr", len(jben_tr))
