#!/usr/bin/env python3
"""Analyze's readings of real, labelled singing, set beside the labels and beside Praat.

Reads what tools/eval/extract.ts and tools/eval/praat_ref.py wrote under data/eval/ and prints:
  pitch      against the notes annotated in Annotated-VocalSet (and PTDB-TUG's reference pitch)
  technique  how well each scale separates the VocalSet techniques it should (ROC area: 0.5 is a
             coin toss, 1 is perfect), for Analyze's scales, its raw measures and Praat's
  vowel      the vowel named against the vowel sung
  agreement  Analyze's measures against Praat's, file by file (rank correlation)
  distortion clear voice against the extreme techniques of EMVD
  contact    the drive scale against how long the folds touch (PTDB-TUG's laryngograph)

usage: tools/eval/.venv/bin/python tools/eval/report.py [pitch] [technique] [vowel] [agreement] [distortion] [contact] [--json out.json]
"""
import csv
import glob
import json
import os
import sys
from collections import Counter, defaultdict

import numpy as np
from scipy.stats import spearmanr
from sklearn.metrics import roc_auc_score

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
EVAL = os.path.join(ROOT, "data", "eval")
RESULT = {}


def load(name):
    rows = []
    for p in sorted(glob.glob(os.path.join(EVAL, f"{name}.[0-9]*.jsonl"))):
        with open(p) as f:
            rows += [json.loads(line) for line in f if line.strip()]
    return [r for r in rows if "error" not in r]


def load_praat(name):
    p = os.path.join(EVAL, f"{name}.praat.jsonl")
    if not os.path.exists(p):
        return {}
    with open(p) as f:
        return {r["path"]: r for r in map(json.loads, f) if "error" not in r}


def num(r, k):
    v = r.get(k)
    return float(v) if isinstance(v, (int, float)) and v is not None else np.nan


def auc(pos, neg, key, src=None):
    """ROC area of `key` telling `pos` from `neg` (rows); NaN if it cannot be computed."""
    get = (lambda r: num(src.get(r["path"], {}), key)) if src is not None else (lambda r: num(r, key))
    a = np.array([get(r) for r in pos])
    b = np.array([get(r) for r in neg])
    a, b = a[np.isfinite(a)], b[np.isfinite(b)]
    if len(a) < 5 or len(b) < 5:
        return float("nan")
    return float(roc_auc_score(np.r_[np.ones(len(a)), np.zeros(len(b))], np.r_[a, b]))


def med(rows, key):
    v = np.array([num(r, key) for r in rows])
    v = v[np.isfinite(v)]
    return float(np.median(v)) if len(v) else float("nan")


# ---------------------------------------------------------------- pitch

def pitch():
    print("\n== PITCH: against the notes annotated in Annotated-VocalSet ==")
    ann = os.path.join(ROOT, "data", "vocalset-annotated", "Annotated VocalSet", "extended 1", "all files.csv")
    notes = defaultdict(list)
    with open(ann, encoding="utf-8", errors="replace") as f:
        rd = csv.reader(f)
        head = [h.strip() for h in next(rd)]
        ix = {h: i for i, h in enumerate(head)}
        for r in rd:
            try:
                if r[ix["Type"]].strip() != "Sound":
                    continue
                gt = float(r[ix["Ground Truth Frequency"]])
                if gt <= 0:
                    continue
                notes[r[0].strip()].append((float(r[ix["Start time"]]), float(r[ix["End time"]]), gt, r[ix["Technique"]].strip(), float(r[ix["Median F0"]] or 0)))
            except (ValueError, IndexError):
                continue
    frames = {}
    for p in sorted(glob.glob(os.path.join(EVAL, "vocalset.frames.*.jsonl"))):
        with open(p) as f:
            for line in f:
                r = json.loads(line)
                frames[os.path.basename(r["path"])[:-4]] = r
    by = defaultdict(list)
    cover = defaultdict(list)
    meas = defaultdict(list)
    for name, ns in notes.items():
        fr = frames.get(name)
        if not fr:
            continue
        f0 = np.array(fr["f0"])
        hop = fr["hop"]
        for t0, t1, gt, tech, theirs in ns:
            # the middle of the note: its edges are slides
            a, b = t0 + 0.25 * (t1 - t0), t1 - 0.25 * (t1 - t0)
            seg = f0[int(round(a / hop)) : max(int(round(a / hop)) + 1, int(round(b / hop)))]
            if not len(seg):
                continue
            v = seg[seg > 0]
            cover[tech].append(len(v) / len(seg))
            cover["ALL"].append(len(v) / len(seg))
            if len(v):
                c = 1200 * np.log2(np.median(v) / gt)
                by[tech].append(c)
                by["ALL"].append(c)
                # the annotators' own measurement of the note (its median pitch over the whole note)
                w = f0[int(round(t0 / hop)) : max(int(round(t0 / hop)) + 1, int(round(t1 / hop)))]
                w = w[w > 0]
                if theirs > 0 and len(w):
                    m = 1200 * np.log2(np.median(w) / theirs)
                    meas[tech].append(m)
                    meas["ALL"].append(m)
    out = {}
    print("against the pitch the annotators measured for each note (the same thing measured twice):")
    print(f"{'technique':26} {'notes':>6} {'median |diff|':>13} {'<10c':>6} {'<50c':>6} {'octave':>7}")
    for tech in ["ALL"] + sorted(k for k in meas if k != "ALL"):
        c = np.array(meas[tech])
        row = dict(notes=len(c), median_abs=float(np.median(np.abs(c))), within10=float(np.mean(np.abs(c) < 10)), within50=float(np.mean(np.abs(c) < 50)), octave=float(np.mean(np.abs(np.abs(c) - 1200) < 150)))
        out["measured:" + tech] = row
        print(f"{tech:26} {row['notes']:6d} {row['median_abs']:11.1f} c {row['within10']:6.1%} {row['within50']:6.1%} {row['octave']:7.2%}")
    print("\nagainst the note written in the score (how far the singers were from it, as much as how well it was read):")
    print(f"{'technique':26} {'notes':>6} {'found':>6} {'median |err|':>12} {'<50c':>6} {'<100c':>6} {'octave':>7}")
    for tech in ["ALL"] + sorted(k for k in by if k != "ALL"):
        c = np.array(by[tech])
        cov = np.mean(cover[tech])
        row = dict(notes=len(cover[tech]), found=float(cov), median_abs=float(np.median(np.abs(c))), within50=float(np.mean(np.abs(c) < 50)), within100=float(np.mean(np.abs(c) < 100)), octave=float(np.mean(np.abs(np.abs(c) - 1200) < 150)))
        out[tech] = row
        print(f"{tech:26} {row['notes']:6d} {row['found']:6.1%} {row['median_abs']:10.1f} c {row['within50']:6.1%} {row['within100']:6.1%} {row['octave']:7.2%}")
    RESULT["pitch"] = out

    # PTDB-TUG: frame by frame against the laryngograph's reference pitch
    refdir = os.path.join(ROOT, "data", "ptdb", "REF")
    fr = {}
    for p in sorted(glob.glob(os.path.join(EVAL, "ptdb.frames.*.jsonl"))):
        with open(p) as f:
            for line in f:
                r = json.loads(line)
                fr[os.path.basename(r["path"])] = r
    if fr and os.path.isdir(refdir):
        gross = fine = both = miss = false = nref = nun = 0
        for name, r in fr.items():
            spk = name.split("_")[1]
            ref = os.path.join(refdir, spk, name.replace("mic_", "ref_").replace(".wav", ".f0"))
            if not os.path.exists(ref):
                continue
            rf = np.loadtxt(ref)[:, 0]  # 10 ms steps, the first frame centred at 16 ms
            mine = np.array(r["f0"])
            for k, g in enumerate(rf):
                i = int(round((0.016 + 0.01 * k) / r["hop"]))
                if i >= len(mine):
                    break
                m = mine[i]
                if g > 0:
                    nref += 1
                    if m > 0:
                        both += 1
                        if abs(m / g - 1) > 0.2:
                            gross += 1
                        elif abs(1200 * np.log2(m / g)) > 50:
                            fine += 1
                    else:
                        miss += 1
                else:
                    nun += 1
                    if m > 0:
                        false += 1
        if both:
            print(f"\nPTDB-TUG speech ({len(fr)} sentences): of {nref} voiced reference frames, {miss / nref:.1%} read as unvoiced; of the rest, gross errors (over 20 %) {gross / both:.2%}, a quarter tone or more off {fine / both:.2%}; of {nun} unvoiced frames, {false / nun:.1%} read as voiced")
            RESULT["ptdb"] = dict(missed=miss / nref, gross=gross / both, quarter=fine / both, false_voiced=false / nun)


# ---------------------------------------------------------------- technique

MINE = ["press", "breath", "grit", "ring", "slope", "alphaRatio", "h1h2", "spr", "ringDb", "nhrLow", "nhrHigh", "sub", "aper", "level", "vibShare", "sungShare", "harshShare"]
PRAAT = ["cpps", "hnr", "jitter", "shimmer", "alpha", "spr", "ringShare", "rms"]


def technique():
    rows = load("vocalset")
    praat = load_praat("vocalset")
    print(f"\n== TECHNIQUE: VocalSet, {len(rows)} recordings (ROC area; under 0.5 means the measure runs the other way) ==")
    T = defaultdict(list)
    for r in rows:
        T[(r["context"], r["technique"])].append(r)
        T[r["technique"]].append(r)
    pairs = [
        ("breathy vs straight (scales, arpeggios)", T[("scales", "breathy")] + T[("arpeggios", "breathy")], T[("scales", "straight")] + T[("arpeggios", "straight")]),
        ("belt vs straight (scales, arpeggios)", T[("scales", "belt")] + T[("arpeggios", "belt")], T[("scales", "straight")] + T[("arpeggios", "straight")]),
        ("belt vs breathy", T["belt"], T["breathy"]),
        ("vocal fry vs straight", T["vocal_fry"], T[("scales", "straight")] + T[("arpeggios", "straight")]),
        ("vibrato vs straight", T["vibrato"] + T["vibrado"], T["straight"]),
        ("forte vs pp (long tones)", T[("long_tones", "forte")], T[("long_tones", "pp")]),
        ("slow forte vs slow piano", T["slow_forte"], T["slow_piano"]),
        ("trillo vs straight (long tones)", T[("long_tones", "trillo")], T[("long_tones", "straight")]),
        ("lip trill vs straight", T["lip_trill"], T[("scales", "straight")] + T[("arpeggios", "straight")]),
        ("inhaled vs straight (long tones)", T[("long_tones", "inhaled")], T[("long_tones", "straight")]),
    ]
    out = {}
    for name, pos, neg in pairs:
        if len(pos) < 5 or len(neg) < 5:
            continue
        a = {k: auc(pos, neg, k) for k in MINE}
        p = {k: auc(pos, neg, k, praat) for k in PRAAT} if praat else {}
        out[name] = {"n": [len(pos), len(neg)], "analyze": a, "praat": p}
        best = sorted(a.items(), key=lambda kv: -abs(kv[1] - 0.5) if np.isfinite(kv[1]) else 0)[:6]
        bestp = sorted(p.items(), key=lambda kv: -abs(kv[1] - 0.5) if np.isfinite(kv[1]) else 0)[:4]
        print(f"\n{name}  ({len(pos)} vs {len(neg)})")
        print("   scales:  " + "  ".join(f"{k} {a[k]:.2f}" for k in ["press", "breath", "grit", "ring"]))
        print("   best of Analyze's measures:  " + "  ".join(f"{k} {v:.2f}" for k, v in best))
        if bestp:
            print("   best of Praat's:             " + "  ".join(f"{k} {v:.2f}" for k, v in bestp))
    print("\nmedian readings by technique:")
    print(f"{'technique':12} {'n':>4} {'press':>6} {'breath':>6} {'grit':>6} {'ring':>6} {'slope':>6} {'alpha':>6} {'spr':>6} {'nhrLo':>6} {'nhrHi':>6} {'vib%':>5} {'sung%':>6} {'harsh%':>6}")
    tab = {}
    for tech in sorted(k for k in T if isinstance(k, str)):
        rs = T[tech]
        tab[tech] = {k: med(rs, k) for k in MINE}
        print(f"{tech:12} {len(rs):4d} " + " ".join(f"{med(rs, k):6.2f}" for k in ["press", "breath", "grit", "ring", "slope", "alphaRatio", "spr", "nhrLow", "nhrHigh"]) + f" {med(rs, 'vibShare'):5.2f} {med(rs, 'sungShare'):6.2f} {med(rs, 'harshShare'):6.2f}")
    RESULT["technique"] = out
    RESULT["technique_medians"] = tab


# ---------------------------------------------------------------- vowel

CLASS = {"EE": "i", "EH": "e", "AH": "a", "OH": "o", "OO": "u"}


def vowel():
    rows = [r for r in load("vocalset") if r.get("vowel") in "aeiou" and r.get("vowel") and r["technique"] in ("straight", "vibrato", "slow_forte", "slow_piano", "forte", "pp", "belt", "breathy", "messa")]
    print(f"\n== VOWEL: VocalSet, {len(rows)} recordings sung on one labelled vowel (the vowel named most, against the vowel sung) ==")
    out = {}
    for body in ("male", "female", "all"):
        rs = [r for r in rows if body == "all" or r["body"] == body]
        conf = defaultdict(Counter)
        for r in rs:
            votes = Counter()
            for name, n in (r.get("vowels") or {}).items():
                votes[CLASS.get(name, "?")] += n
            if votes:
                conf[r["vowel"]][votes.most_common(1)[0][0]] += 1
        tot = sum(sum(c.values()) for c in conf.values())
        ok = sum(conf[v][v] for v in conf)
        out[body] = {"n": tot, "accuracy": ok / max(1, tot), "confusion": {v: dict(conf[v]) for v in "aeiou"}}
        print(f"\n{body}: {ok / max(1, tot):.1%} of {tot}   (rows: sung; columns: named)")
        print("      " + "".join(f"{c:>6}" for c in "aeiou?"))
        for v in "aeiou":
            n = sum(conf[v].values())
            print(f"   {v}  " + "".join(f"{conf[v][c] / max(1, n):6.0%}" for c in "aeiou?") + f"   n={n}")
    # by pitch: a high note's few harmonics say less about the vowel
    print("\nby the recording's middle pitch:")
    for lo, hi in ((0, 200), (200, 300), (300, 400), (400, 550), (550, 2000)):
        rs = [r for r in rows if lo <= (r.get("f0") or 0) < hi]
        ok = 0
        for r in rs:
            votes = Counter()
            for name, n in (r.get("vowels") or {}).items():
                votes[CLASS.get(name, "?")] += n
            ok += bool(votes) and votes.most_common(1)[0][0] == r["vowel"]
        if rs:
            print(f"   {lo:4d}-{hi:4d} Hz: {ok / len(rs):.1%} of {len(rs)}")
            out.setdefault("by_pitch", {})[f"{lo}-{hi}"] = {"n": len(rs), "accuracy": ok / len(rs)}
    RESULT["vowel"] = out


# ---------------------------------------------------------------- agreement

def agreement():
    rows = load("vocalset")
    praat = load_praat("vocalset")
    if not praat:
        print("\n(no Praat readings yet: run tools/eval/praat_ref.py)")
        return
    print(f"\n== AGREEMENT with Praat, {len(rows)} VocalSet recordings (rank correlation) ==")
    pairs = [("f0", "f0"), ("F1", "F1"), ("F2", "F2"), ("F3", "F3"), ("alphaRatio", "alpha"), ("slope", "alpha"), ("spr", "spr"), ("ringDb", "ringShare"), ("nhrHigh", "cpps"), ("nhrLow", "hnr"), ("nhrHigh", "hnr"), ("breath", "cpps"), ("grit", "jitter"), ("grit", "shimmer"), ("level", "rms")]
    out = {}
    for a, b in pairs:
        x = np.array([num(r, a) for r in rows])
        y = np.array([num(praat.get(r["path"], {}), b) for r in rows])
        m = np.isfinite(x) & np.isfinite(y)
        if m.sum() < 20:
            continue
        rho = float(spearmanr(x[m], y[m]).statistic)
        out[f"{a}~{b}"] = rho
        extra = ""
        if a == b and a in ("f0", "F1", "F2", "F3"):
            extra = f"   median difference {np.median(np.abs(x[m] / y[m] - 1)):.1%}"
        print(f"   Analyze {a:10} ~ Praat {b:10} {rho:+.2f}{extra}")
    RESULT["agreement"] = out


# ---------------------------------------------------------------- distortion

def distortion():
    rows = load("emvd")
    praat = load_praat("emvd")
    if not rows:
        return
    print(f"\n== DISTORTION: EMVD, {len(rows)} recordings ==")
    T = defaultdict(list)
    for r in rows:
        T[r["technique"] if r["type"] != "Effect" else "Effect:" + r["technique"]].append(r)
    clear = T["ClearVoice"]
    print(f"{'technique':24} {'n':>4} {'sung%':>6} {'harsh%':>6} {'either':>6} {'grit':>6} {'nhrLo':>6} {'sub':>6} {'AUC grit':>9} {'AUC nhrLo':>9}")
    out = {}
    for tech in sorted(T):
        rs = T[tech]
        a = {k: (auc(rs, clear, k) if tech != "ClearVoice" else float("nan")) for k in ["grit", "nhrLow", "sub", "harshShare"]}
        # heard as a voice at all: sung with a pitch, or flagged harsh
        either = float(np.median([num(r, "sungShare") + num(r, "harshShare") for r in rs]))
        out[tech] = {"n": len(rs), "sung": med(rs, "sungShare"), "harsh": med(rs, "harshShare"), "either": either, "grit": med(rs, "grit"), "auc": a}
        print(f"{tech:24} {len(rs):4d} {med(rs, 'sungShare'):6.2f} {med(rs, 'harshShare'):6.2f} {either:6.2f} {med(rs, 'grit'):6.2f} {med(rs, 'nhrLow'):6.1f} {med(rs, 'sub'):6.1f} {a['grit']:9.2f} {a['nhrLow']:9.2f}")
    if praat:
        dist = [r for t, rs in T.items() if t != "ClearVoice" and not t.startswith("Effect") for r in rs]
        print("   Praat, any distortion vs clear voice (ROC area): " + "  ".join(f"{k} {auc(dist, clear, k, praat):.2f}" for k in ["hnr", "cpps", "jitter", "shimmer"]))
    RESULT["distortion"] = out


# ---------------------------------------------------------------- fold contact

def contact():
    """Drive, read from the microphone, beside how long the folds really touch (the laryngograph)."""
    egg = {}
    p = os.path.join(EVAL, "ptdb.egg.jsonl")
    if not os.path.exists(p):
        return
    with open(p) as f:
        for line in f:
            r = json.loads(line)
            egg[os.path.basename(r["path"])] = r
    fr = {}
    for q in sorted(glob.glob(os.path.join(EVAL, "ptdb.frames.*.jsonl"))):
        with open(q) as f:
            for line in f:
                r = json.loads(line)
                fr[os.path.basename(r["path"])] = r
    by = defaultdict(lambda: {"cq": [], "press": [], "slope": [], "scq": [], "spress": []})
    for name, e in egg.items():
        a = fr.get(name)
        if not a:
            continue
        cq = e["frames"]
        pr, sl, f0 = a["press"], a["slope"], a["f0"]
        d = by[e["speaker"]]
        got = []
        for k, c in enumerate(cq):
            # the reference's frame k is centred 16 ms + k x 10 ms in: Analyze's frame k + 2
            i = k + 2
            if c is None or i >= len(f0) or not f0[i] > 0:
                continue
            d["cq"].append(c)
            d["press"].append(pr[i])
            d["slope"].append(sl[i])
            got.append(pr[i])
        if len(got) >= 20:
            d["scq"].append(e["cq"])
            d["spress"].append(float(np.median(got)))
    if not by:
        return
    print("\n== FOLD CONTACT: PTDB-TUG read speech, the laryngograph's contact quotient against Analyze's drive (rank correlation) ==")
    out = {}
    for spk in sorted(by):
        d = by[spk]
        a = spearmanr(d["cq"], d["press"]).correlation
        b = spearmanr(d["cq"], d["slope"]).correlation
        c = spearmanr(d["scq"], d["spress"]).correlation
        out[spk] = {"frames": len(d["cq"]), "drive": float(a), "slope": float(b), "sentences": len(d["scq"]), "by_sentence": float(c), "cq": float(np.median(d["cq"]))}
        print(f"   {spk}: {len(d['cq']):6d} voiced frames, contact quotient {np.median(d['cq']):.2f} in the middle:  drive {a:+.2f}  slope {b:+.2f}   sentence by sentence ({len(d['scq'])}): drive {c:+.2f}")
    RESULT["contact"] = out


if __name__ == "__main__":
    want = [a for a in sys.argv[1:] if not a.startswith("--") and not a.endswith(".json")]
    for name, fn in (("pitch", pitch), ("technique", technique), ("vowel", vowel), ("agreement", agreement), ("distortion", distortion), ("contact", contact)):
        if not want or name in want:
            fn()
    if "--json" in sys.argv:
        with open(sys.argv[sys.argv.index("--json") + 1], "w") as f:
            json.dump(RESULT, f, indent=1)
