#!/usr/bin/env python3
"""Analyze's formants against Praat's on the same recordings, and what each says about the vowel sung.

usage: tools/eval/.venv/bin/python tools/eval/formant_report.py   (after tools/eval/formant-check.ts)
"""
import collections, glob, json, math, os, re
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
rows = []
for p in sorted(glob.glob(os.path.join(ROOT, "data", "eval", "formants.*.jsonl"))):
    for l in open(p):
        r = json.loads(l)
        m = re.search(r"FULL/((?:fe)?male\d+)/([^/]+)/([^/]+)/.*_([aeiou])\.wav$", r["path"])
        if not m or not r.get("F1") or not r.get("F2"):
            continue
        r.update(singer=m.group(1), tech=m.group(3), vowel=m.group(4), body="female" if m.group(1).startswith("f") else "male")
        rows.append(r)
print(f"{len(rows)} recordings read by both")
for lo, hi in ((0, 250), (250, 350), (350, 450), (450, 2000)):
    rr = [r for r in rows if lo <= (r["f0"] or 0) < hi]
    if len(rr) < 10:
        continue
    line = f"pitch {lo:4d}-{hi:4d} Hz ({len(rr):4d}): median difference from Praat"
    for k in ("F1", "F2", "F3"):
        d = np.array([abs(r[k] / r["p" + k] - 1) for r in rr if r.get(k) and r.get("p" + k)])
        line += f"   {k} {np.median(d):5.1%} (within 10 %: {np.mean(d < 0.1):4.0%})"
    print(line)


def loso(rows, k1, k2):
    singers = sorted(set(r["singer"] for r in rows))
    ok = 0
    conf = collections.defaultdict(collections.Counter)
    for s in singers:
        tr = [r for r in rows if r["singer"] != s]
        cen = {}
        for v in "aeiou":
            pts = [[math.log(r[k1]), math.log(r[k2])] for r in tr if r["vowel"] == v]
            if pts:
                cen[v] = np.mean(pts, axis=0)
        for r in rows:
            if r["singer"] != s:
                continue
            p = np.array([math.log(r[k1]), math.log(r[k2])])
            g = min(cen, key=lambda v: np.linalg.norm((p - cen[v]) * np.array([1.6, 1.0])))
            conf[r["vowel"]][g] += 1
            ok += g == r["vowel"]
    return ok / max(1, len(rows)), conf


TECH = ("straight", "slow_forte", "slow_piano", "forte", "pp", "vibrato", "belt", "breathy", "messa", "fast_forte", "fast_piano")
for g in ("male", "female"):
    rr = [r for r in rows if r["body"] == g and r["tech"] in TECH and r.get("pF1") and r.get("pF2")]
    a, conf = loso(rr, "F1", "F2")
    b, _ = loso(rr, "pF1", "pF2")
    print(f"\n{g}: vowel from (F1, F2), nearest centre, singers held out: Analyze {a:.1%}, Praat {b:.1%}  (of {len(rr)})")
    for v in "aeiou":
        n = sum(conf[v].values())
        print("   ", v, " ".join(f"{conf[v][c] / max(1, n):5.0%}" for c in "aeiou"), f"   Analyze F1 {np.median([r['F1'] for r in rr if r['vowel'] == v]):4.0f} F2 {np.median([r['F2'] for r in rr if r['vowel'] == v]):4.0f}   Praat F1 {np.median([r['pF1'] for r in rr if r['vowel'] == v]):4.0f} F2 {np.median([r['pF2'] for r in rr if r['vowel'] == v]):4.0f}")
    for lo, hi in ((0, 200), (200, 300), (300, 400), (400, 550), (550, 2000)):
        r2 = [r for r in rr if lo <= (r["f0"] or 0) < hi]
        if len(r2) > 25 and len(set(r["singer"] for r in r2)) > 2:
            print(f"      pitch {lo}-{hi} Hz: Analyze {loso(r2, 'F1', 'F2')[0]:.1%}, Praat {loso(r2, 'pF1', 'pF2')[0]:.1%}  (of {len(r2)})")
