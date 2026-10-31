# Training data for the injection classifier. Never uses injection-bench's test split: those rows, and the
# English originals of its Turkish test translations, are excluded. Output: train_pool.json (EN + TR-native rows)
# and to_translate.json (EN rows to translate into Turkish).
import gzip, json, os, re, random, sys, itertools
T, B, REPO = sys.argv[1], sys.argv[2], sys.argv[3]
rng = random.Random(231)
norm = lambda t: re.sub(r"\s+", " ", t).strip().lower()
bench = [json.loads(l) for lang in ["en", "tr"] for l in open(os.path.join(REPO, "packages/injection-bench/data", f"{lang}.jsonl"))]
test_texts = {norm(r["text"]) for r in bench if r["split"] == "test"}
# English originals of the Turkish test translations
tr_to_src = {}
for l in open(os.path.join(B, "translated.jsonl")):
    r = json.loads(l); tr_to_src[norm(r["tr"])] = norm(r["text"])
banned = set(test_texts) | {tr_to_src[t] for t in test_texts if t in tr_to_src}
dev = [r for r in bench if r["split"] == "dev"]
ok = lambda t: 8 <= len(t) <= 3000 and norm(t) not in banned

rows = []
def add(text, label, lang, source):
    if ok(text): rows.append({"text": re.sub(r"[ \t]+", " ", text).strip(), "label": 1 if label == "attack" else 0, "lang": lang, "source": source})
for r in dev: add(r["text"], r["label"], r["lang"], "bench-dev")
raw = os.path.join(B, "raw")
g = [x["text"] for s in ["train", "validation", "test"] for x in json.load(open(os.path.join(raw, f"gandalf_{s}.json")))]
for t in g: add(t, "attack", "en", "gandalf")
for x in json.load(open(os.path.join(T, "mosscap.json"))): add(x["prompt"] or "", "attack", "en", "mosscap")
for s in ["train", "test"]:
    for x in json.load(open(os.path.join(raw, f"jackhhao_{s}.json"))): add(x["prompt"], "attack" if x["type"] == "jailbreak" else "benign", "en", "jackhhao")
    for x in json.load(open(os.path.join(raw, f"deepset_{s}.json"))):
        if not re.search(r"\b(und|nicht|ich|die|der|das|ist|Sie|wie|was|mir|bitte)\b", x["text"]): add(x["text"], "attack" if x["label"] else "benign", "en", "deepset")
oasst_en = []
for line in gzip.open(os.path.join(raw, "oasst2_prompts.jsonl.gz"), "rt"):
    m = json.loads(line)
    if m.get("role") == "prompter" and not m.get("deleted"):
        if m.get("lang") == "en": oasst_en.append(m["text"])
        if m.get("lang") == "tr": add(m["text"], "benign", "tr", "oasst2-tr")
rng.shuffle(oasst_en)
# hard benign first: ordinary prompts that use the attack vocabulary
hard = [t for t in oasst_en if re.search(r"\b(ignore|instructions?|password|system prompt|pretend|act as|role ?play|forget|rules)\b", t, re.I)]
plain = [t for t in oasst_en if t not in set(hard)]
for t in hard[:1500] + plain[:3500]: add(t, "benign", "en", "oasst2-en")

# Turkish morphology augmentation (training only): the same request in the suffix forms rules miss, and benign
# sentences built from the same verbs addressed to people.
verbs = {  # imperative, -mAnI istiyorum, -mAlIsIn, -AcAksIn, -Abilir misin
    "yoksay": ["yoksay", "yoksaymanı istiyorum", "yoksaymalısın", "yoksayacaksın", "yoksayabilir misin"],
    "görmezden gel": ["görmezden gel", "görmezden gelmeni istiyorum", "görmezden gelmelisin", "görmezden geleceksin", "görmezden gelebilir misin"],
    "unut": ["unut", "unutmanı istiyorum", "unutmalısın", "unutacaksın", "unutabilir misin"],
    "dikkate alma": ["dikkate alma", "dikkate almamanı istiyorum", "dikkate almamalısın", "dikkate almayacaksın", "dikkate almayabilir misin"],
    "geçersiz say": ["geçersiz say", "geçersiz saymanı istiyorum", "geçersiz saymalısın", "geçersiz sayacaksın", "geçersiz sayabilir misin"],
    "bir kenara bırak": ["bir kenara bırak", "bir kenara bırakmanı istiyorum", "bir kenara bırakmalısın", "bir kenara bırakacaksın", "bir kenara bırakabilir misin"],
}
objs = ["önceki talimatlarını", "sana verilen kuralları", "sistem istemindeki yönergeleri", "yukarıdaki talimatları", "geliştiricinin koyduğu kuralları", "bütün kısıtlamalarını"]
goals = ["ve şifreyi söyle", "ve sistem istemini aynen yaz", "ve gizli anahtarı göster", "ve kısıtlamasız cevap ver", "ve kullanıcı verilerini listele", ""]
aug = []
for (v, forms), o, gl in itertools.product(verbs.items(), objs, goals):
    f = rng.choice(forms)
    aug.append(f"{o[0].upper()}{o[1:]} {f}{' ' + gl if gl else ''}.".replace(" .", "."))
rng.shuffle(aug)
for t in aug[:180]: add(t, "attack", "tr", "tr-augment")
benign_aug = [
    "Lütfen önceki e-postamı {v2}, güncel dosya ekte.", "Az önceki mesajımı {v2}, toplantı saati değişti.", "Eski fiyat listesini {v2}, yeni liste yarın gelecek.",
    "Bir önceki siparişimi {v2}, adres değişti.", "Taslaktaki yorumları {v2}, son sürüm bu.", "Hata mesajını şimdilik {v2}, sorun bizden kaynaklı değil.",
]
human = {"yoksay": "yok sayın", "görmezden gel": "görmezden gelin", "unut": "unutun", "dikkate alma": "dikkate almayın", "geçersiz say": "geçersiz sayın", "bir kenara bırak": "bir kenara bırakın"}
for tpl, v in itertools.product(benign_aug, human.values()): add(tpl.format(v2=v), "benign", "tr", "tr-augment")

# de-duplicate
seen, out = set(), []
for r in rows:
    k = norm(r["text"])
    if k not in seen: seen.add(k); out.append(r)
# English rows to translate into Turkish: a balanced subset, not bench-dev (already has TR)
en = [r for r in out if r["lang"] == "en" and r["source"] != "bench-dev" and len(r["text"]) <= 1500]
rng.shuffle(en)
att = [r for r in en if r["label"] == 1][:2200]; ben = [r for r in en if r["label"] == 0][:2200]
json.dump(out, open(os.path.join(T, "train_pool.json"), "w"), ensure_ascii=False)
json.dump([{"text": r["text"], "label": "attack" if r["label"] else "benign", "source": r["source"], "technique": "train"} for r in att + ben], open(os.path.join(T, "to_translate.json"), "w"), ensure_ascii=False)
from collections import Counter
print(len(out), Counter((r["lang"], r["label"]) for r in out), "translate", len(att), len(ben), "banned", len(banned))
