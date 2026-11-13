#!/usr/bin/env python3
"""Check docs/aso/listing.json against App Store limits and write the outputs.

  python3 docs/aso/build.py                 # check + write store.config.json and listing.md
  TWO_STEP=0 python3 docs/aso/build.py      # leave out the two-step unlock lines (if PR #14 is not shipped)
  BACKUP=0 python3 docs/aso/build.py        # describe the app without encrypted backup (if it is not shipped)
  PRIVACY_URL=https://... SUPPORT_URL=https://... python3 docs/aso/build.py

store.config.json is the EAS Metadata file (`eas metadata:push`). It is written here, not in app/,
so nothing is pushed by accident; copy it to app/ when the website URLs are real.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LIMITS = {"title": 30, "subtitle": 30, "keywords": 100, "promoText": 170, "description": 4000}
IAP_LIMITS = {"name": 30, "description": 45}
TWO_STEP = os.environ.get("TWO_STEP", "1") != "0"
BACKUP = os.environ.get("BACKUP", "1") != "0"
PRIVACY_URL = os.environ.get("PRIVACY_URL", "https://REPLACE-WITH-WEBSITE/privacy.html")
SUPPORT_URL = os.environ.get("SUPPORT_URL", "https://REPLACE-WITH-WEBSITE/")

src = json.load(open(os.path.join(HERE, "listing.json"), encoding="utf-8"))
errors, rows = [], []


def words(s):
    return {w for w in re.split(r"[\s,:&·、，/-]+", s.lower()) if w}


# Tagged lines: [2STEP] = two-step unlock (PR #14); [BACKUP] / [NOBACKUP] = with / without the
# encrypted backup with recovery key (feature/encrypted-backup).
TAGS = {"[2STEP]": TWO_STEP, "[BACKUP]": BACKUP, "[NOBACKUP]": not BACKUP}


def description(lines):
    out = []
    for line in lines:
        for tag, keep in TAGS.items():
            if line.startswith(tag):
                if not keep:
                    break
                line = line[len(tag):]
        else:
            out.append(line)
            continue
        if line and not line.startswith("["):
            out.append(line)
    return "\n".join(out)


info = {}
for loc, v in src["locales"].items():
    kw = ",".join(v["keywords"])
    desc = description(v["description"])
    fields = {"title": v["title"], "subtitle": v["subtitle"], "keywords": kw, "promoText": v["promoText"], "description": desc}
    for k, lim in LIMITS.items():
        if len(fields[k]) > lim:
            errors.append(f"{loc} {k}: {len(fields[k])} > {lim}")
    for k, lim in IAP_LIMITS.items():
        if len(v["iap"][k]) > lim:
            errors.append(f"{loc} iap.{k}: {len(v['iap'][k])} > {lim}")
    if " ," in kw or ", " in kw:
        errors.append(f"{loc} keywords: no spaces around commas")
    if len(set(x.lower() for x in v["keywords"])) != len(v["keywords"]):
        errors.append(f"{loc} keywords: duplicates")
    # A word already in the name or subtitle is indexed there; repeating it wastes keyword space.
    dup = words(v["title"] + " " + v["subtitle"]) & {x.lower() for x in v["keywords"]}
    # CJK and Hangul have no spaces: also catch keywords that sit inside (or contain) a name/subtitle phrase.
    if re.search(r"[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]", v["title"] + v["subtitle"]):
        ns = v["title"] + v["subtitle"]
        flat = re.sub(r"\s+", "", ns)
        # Compounds such as 사진잠금 are their own search terms, so only a keyword found inside the name/subtitle counts.
        dup |= {k for k in v["keywords"] if len(k) > 1 and (k in ns or k in flat)}
    if dup:
        errors.append(f"{loc} keywords repeat name/subtitle words: {sorted(dup)}")
    if len(v["shots"]) != 7:
        errors.append(f"{loc}: expected 7 screenshot captions")
    rows.append((loc, len(v["title"]), len(v["subtitle"]), len(kw), len(v["promoText"]), len(desc)))
    info[loc] = {
        "title": v["title"],
        "subtitle": v["subtitle"],
        "description": desc,
        "keywords": v["keywords"],
        "promoText": v["promoText"],
        "supportUrl": SUPPORT_URL,
        "privacyPolicyUrl": PRIVACY_URL,
    }

print(f"{'locale':8} {'name':>5} {'sub':>5} {'kw':>5} {'promo':>6} {'desc':>6}   (limits 30/30/100/170/4000)")
for r in rows:
    print(f"{r[0]:8} {r[1]:5} {r[2]:5} {r[3]:5} {r[4]:6} {r[5]:6}")
if errors:
    print("\nERRORS:\n  " + "\n  ".join(errors))
    sys.exit(1)

config = {
    "configVersion": 0,
    "apple": {
        "copyright": src["copyright"],
        "categories": src["categories"],
        "info": info,
    },
}
with open(os.path.join(HERE, "store.config.json"), "w", encoding="utf-8") as f:
    json.dump(config, f, ensure_ascii=False, indent=2)
    f.write("\n")

# Copy-paste sheet for App Store Connect, one section per language.
md = [
    "# App Store 입력 시트 (자동 생성)",
    "",
    "`docs/aso/listing.json`에서 `python3 docs/aso/build.py`로 만든 파일입니다. 직접 고치지 말고 listing.json을 고친 뒤 다시 만드세요.",
    f"두 겹 잠금 문장 포함: **{'예' if TWO_STEP else '아니요'}** (PR #14가 출시 빌드에 없으면 `TWO_STEP=0`으로 다시 만들기)",
    f"암호화 백업 문장 포함: **{'예' if BACKUP else '아니요'}** (백업 기능이 출시 빌드에 없으면 `BACKUP=0`으로 다시 만들기)",
    "",
]
for loc, v in src["locales"].items():
    i = info[loc]
    md += [
        f"## {loc}",
        "",
        f"**Name**: `{i['title']}`  ",
        f"**Subtitle**: `{i['subtitle']}`  ",
        f"**Keywords**: `{','.join(i['keywords'])}`",
        "",
        "**Promotional Text**:",
        "```",
        i["promoText"],
        "```",
        "**Description**:",
        "```",
        i["description"],
        "```",
        f"**In-App Purchase** (Lifetime Premium 현지화): Display Name `{v['iap']['name']}` / Description `{v['iap']['description']}`",
        "",
        "**스크린샷 문구** (순서대로):",
        "",
    ]
    shots = [x for i, x in enumerate(v["shots"]) if TWO_STEP or i != 1]  # shot 2 = two-step unlock
    md += [f"{n}. {h} — {s}" for n, (h, s) in enumerate(shots, 1)]
    md.append("")
with open(os.path.join(HERE, "listing.md"), "w", encoding="utf-8") as f:
    f.write("\n".join(md))
print("\nwrote store.config.json and listing.md")
