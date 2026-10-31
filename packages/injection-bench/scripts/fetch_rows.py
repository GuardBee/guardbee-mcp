import json, sys, urllib.request, time
ds, split, total, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
rows = []
for off in range(0, total, 100):
    url = f"https://datasets-server.huggingface.co/rows?dataset={ds}&config=default&split={split}&offset={off}&length=100"
    for attempt in range(5):
        try:
            d = json.load(urllib.request.urlopen(url, timeout=60)); break
        except Exception as e:
            time.sleep(3)
    rows += [r["row"] for r in d["rows"]]
json.dump(rows, open(out, "w"), ensure_ascii=False)
print(ds, split, len(rows))
