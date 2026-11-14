#!/usr/bin/env python3
"""How long the vocal folds are in contact in each cycle, from PTDB-TUG's laryngograph recordings.

A laryngograph measures the electrical contact across the folds: it is the nearest thing to a
direct measurement of fold closure there is without a camera. The contact quotient here is the
share of each cycle the signal spends above half-way between its trough and its peak (the usual
50 % criterion). tools/eval/report.py sets Analyze's closure reading, made from the microphone
alone, beside it.

usage: tools/eval/.venv/bin/python tools/eval/egg.py
output: data/eval/ptdb.egg.jsonl  (per sentence: the median quotient, and one value per 10 ms frame)
"""
import json
import os

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfiltfilt

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PTDB = os.path.join(ROOT, "data", "ptdb")


def contact_quotient(lx, fs, f0, hop=0.01, first=0.016):
    """Per reference-pitch frame: the contact quotient of the cycles around it (NaN where unvoiced)."""
    sos = butter(2, [40, 4000], btype="band", fs=fs, output="sos")
    x = sosfiltfilt(sos, lx)
    # contact is the side the signal rises to quickly: the closing of the folds is abrupt
    d = np.diff(x)
    if abs(d.min()) > abs(d.max()):
        x = -x
    out = np.full(len(f0), np.nan)
    for k, f in enumerate(f0):
        if f <= 0:
            continue
        c = int(round((first + k * hop) * fs))
        half = int(round(1.5 * fs / f))
        seg = x[max(0, c - half) : c + half]
        if len(seg) < 3 * fs / f * 0.8:
            continue
        lo, hi = seg.min(), seg.max()
        if hi - lo < 1e-4:
            continue
        out[k] = float(np.mean(seg > lo + 0.5 * (hi - lo)))
    return out


def main():
    dst = os.path.join(ROOT, "data", "eval", "ptdb.egg.jsonl")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    n = 0
    with open(dst, "w") as f:
        for spk in sorted(os.listdir(os.path.join(PTDB, "LAR"))):
            for name in sorted(os.listdir(os.path.join(PTDB, "LAR", spk))):
                ref = os.path.join(PTDB, "REF", spk, name.replace("lar_", "ref_").replace(".wav", ".f0"))
                if not os.path.exists(ref):
                    continue
                lx, fs = sf.read(os.path.join(PTDB, "LAR", spk, name), dtype="float64")
                f0 = np.loadtxt(ref)[:, 0]
                cq = contact_quotient(lx, fs, f0)
                v = cq[np.isfinite(cq)]
                if len(v) < 20:
                    continue
                f.write(json.dumps({"path": f"ptdb/MIC/{spk}/{name.replace('lar_', 'mic_')}", "speaker": spk, "cq": round(float(np.median(v)), 4), "frames": [None if not np.isfinite(c) else round(float(c), 3) for c in cq]}) + "\n")
                n += 1
    print(f"{dst}: {n} sentences")


if __name__ == "__main__":
    main()
