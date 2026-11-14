#!/usr/bin/env python3
"""Set Analyze's scales from labelled singing, and say how well each then tells the techniques apart.

Each scale (air, drive, ring, grit) is a logistic model over two or three of Analyze's measures,
fitted to recordings whose technique is known (VocalSet; EMVD for distortion). Its honest score is
the ROC area with every singer held out in turn: the model that scores a singer never saw them.
The models fitted on everyone are written to src/analyze/scales.generated.json, which
src/analyze/interpret.ts reads. Regenerate, never edit.

usage: tools/eval/.venv/bin/python tools/eval/fit.py [--write]
"""
import glob
import json
import os
import sys

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
EVAL = os.path.join(ROOT, "data", "eval")


def load(name):
    rows = []
    for p in sorted(glob.glob(os.path.join(EVAL, f"{name}.[0-9]*.jsonl"))):
        with open(p) as f:
            rows += [json.loads(line) for line in f if line.strip()]
    return [r for r in rows if "error" not in r and r.get("sung", 0) and r["sung"] > 0.5]


def X_of(rows, feats):
    return np.array([[r.get(k) if isinstance(r.get(k), (int, float)) else np.nan for k in feats] for r in rows], dtype=float)


def fit(name, pos, neg, feats, C=1.0):
    """Logistic model telling pos from neg on feats; ROC area with each singer held out."""
    rows = pos + neg
    X = X_of(rows, feats)
    y = np.r_[np.ones(len(pos)), np.zeros(len(neg))]
    ok = np.isfinite(X).all(1)
    rows = [r for r, o in zip(rows, ok) if o]
    X, y = X[ok], y[ok]
    mean, scale = X.mean(0), X.std(0) + 1e-9
    Z = (X - mean) / scale
    singers = sorted(set(r["singer"] for r in rows))
    who = np.array([r["singer"] for r in rows])
    held = np.full(len(y), np.nan)
    for s in singers:
        te = who == s
        if te.sum() == 0 or len(set(y[~te])) < 2:
            continue
        m = LogisticRegression(C=C, max_iter=2000, class_weight="balanced").fit(Z[~te], y[~te])
        held[te] = m.decision_function(Z[te])
    k = np.isfinite(held)
    auc = roc_auc_score(y[k], held[k])
    # per singer: within one voice, does the scale put the technique above the plain singing?
    per = []
    for s in singers:
        te = (who == s) & k
        if len(set(y[te])) == 2:
            per.append(roc_auc_score(y[te], held[te]))
    m = LogisticRegression(C=C, max_iter=2000, class_weight="balanced").fit(Z, y)
    single = {f: roc_auc_score(y, X[:, i]) for i, f in enumerate(feats)}
    print(f"\n{name}: {int(y.sum())} vs {int(len(y) - y.sum())} recordings, {len(singers)} singers")
    print(f"   ROC area, singers held out: {auc:.3f}   (within each singer: median {np.median(per):.3f}, worst {np.min(per):.3f})")
    print("   each measure alone: " + "  ".join(f"{f} {a:.2f}" for f, a in single.items()))
    print("   weights (per standard deviation): " + "  ".join(f"{f} {c:+.2f}" for f, c in zip(feats, m.coef_[0])))
    return {"features": feats, "mean": [round(float(v), 4) for v in mean], "scale": [round(float(v), 4) for v in scale], "coef": [round(float(v), 4) for v in m.coef_[0]], "intercept": round(float(m.intercept_[0]), 4), "auc": round(float(auc), 3), "n": [int(y.sum()), int(len(y) - y.sum())]}, m, mean, scale


def score(model, rows):
    X = X_of(rows, model["features"])
    z = ((X - np.array(model["mean"])) / np.array(model["scale"])) @ np.array(model["coef"]) + model["intercept"]
    return 1 / (1 + np.exp(-z))


def main():
    vs = load("vocalset")
    em = load("emvd")
    T = lambda rows, *names: [r for r in rows if r.get("technique") in names]
    C = lambda rows, ctx, *names: [r for r in rows if r.get("context") in ctx and r.get("technique") in names]
    sa = ("scales", "arpeggios")
    straight = C(vs, sa, "straight")
    out = {}

    # air: breathy singing against the same singers' straight tone
    out["breath"], *_ = fit("AIR  breathy vs straight tone", C(vs, sa, "breathy"), straight, ["nhrHigh", "h1h2"])

    # drive: belt against soft singing, the two ends of how hard a voice is driven
    soft = T(vs, "breathy", "pp", "slow_piano", "fast_piano")
    hard = T(vs, "belt", "forte", "slow_forte", "fast_forte")
    out["press"], *_ = fit("DRIVE  belt and forte vs breathy and piano", hard, soft, ["slope", "alphaRatio", "h1h2"])

    # ring: the 2-4 kHz band, as the singing power ratio; the same two ends
    out["ring"], *_ = fit("RING  belt and forte vs breathy and piano", hard, soft, ["spr", "ringDb"])

    # grit: vocal fry and the extreme distortions against ordinary singing of every kind
    plain = T(vs, "straight", "vibrato", "belt", "breathy", "forte", "pp", "slow_forte", "slow_piano", "fast_forte", "fast_piano", "messa") + [r for r in em if r.get("technique") == "ClearVoice"]
    rough = T(vs, "vocal_fry") + [r for r in em if r.get("type") == "Technique" and r.get("technique") != "ClearVoice"]
    # (the first harmonic's lead over the second keeps a breathy voice, which also has noise low down, from reading as grit)
    out["grit"], *_ = fit("GRIT  vocal fry and distortion vs ordinary singing", rough, plain, ["nhrLow", "sub", "h1h2"])

    # what each scale reads on each technique (the middle recording)
    print("\nthe scales by technique (median over recordings):")
    print(f"{'technique':14} {'n':>4} {'air':>5} {'drive':>6} {'ring':>5} {'grit':>5}")
    table = {}
    groups = {}
    for r in vs:
        groups.setdefault(r["technique"], []).append(r)
    for r in em:
        groups.setdefault("EMVD " + r["technique"], []).append(r)
    for g in sorted(groups):
        rs = groups[g]
        if len(rs) < 8:
            continue
        v = {k: float(np.nanmedian(score(out[k], rs))) for k in ("breath", "press", "ring", "grit")}
        table[g] = v
        print(f"{g:14} {len(rs):4d} {v['breath']:5.2f} {v['press']:6.2f} {v['ring']:5.2f} {v['grit']:5.2f}")
    # checks the scales were not fitted to: does grit stay off a vibrato, air off a belt?
    checks = {
        "grit: vibrato vs straight (should be near 0.5: a vibrato is not grit)": (T(vs, "vibrato"), T(vs, "straight"), "grit"),
        "air: pp vs forte (long tones)": (C(vs, ("long_tones",), "pp"), C(vs, ("long_tones",), "forte"), "breath"),
        "drive: belt vs straight tone": (C(vs, sa, "belt"), straight, "press"),
        "ring: belt vs straight tone": (C(vs, sa, "belt"), straight, "ring"),
        "grit: EMVD distortion vs EMVD clear voice": ([r for r in em if r.get("type") == "Technique" and r.get("technique") != "ClearVoice"], [r for r in em if r.get("technique") == "ClearVoice"], "grit"),
        "grit: vocal fry vs straight tone": (T(vs, "vocal_fry"), straight, "grit"),
        "grit: breathy vs straight tone (should be near 0.5: breath is not grit)": (C(vs, sa, "breathy"), straight, "grit"),
    }
    print("\nchecks:")
    res = {}
    for name, (pos, neg, k) in checks.items():
        a, b = score(out[k], pos), score(out[k], neg)
        a, b = a[np.isfinite(a)], b[np.isfinite(b)]
        auc = roc_auc_score(np.r_[np.ones(len(a)), np.zeros(len(b))], np.r_[a, b])
        res[name] = round(float(auc), 3)
        print(f"   {auc:.3f}  {name}")
    out["_about"] = "Fitted by tools/eval/fit.py on VocalSet and EMVD (both CC BY 4.0). Regenerate, never edit."
    if "--write" in sys.argv:
        dst = os.path.join(ROOT, "src", "analyze", "scales.generated.json")
        with open(dst, "w") as f:
            json.dump(out, f, indent=1)
        print(f"\nwrote {dst}")
    with open(os.path.join(EVAL, "fit.json"), "w") as f:
        json.dump({"models": out, "by_technique": table, "checks": res}, f, indent=1)


if __name__ == "__main__":
    main()
