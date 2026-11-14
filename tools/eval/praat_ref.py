#!/usr/bin/env python3
"""Praat's readings of the same recordings Analyze is run on: an independent reference.

For each recording: pitch, harmonics-to-noise ratio, smoothed cepstral peak prominence (CPPS, the
standard measure of breathiness), jitter and shimmer, formants, and the long-term spectrum's usual
summaries (alpha ratio, singing power ratio, Hammarberg index). tools/eval/report.py sets them
beside Analyze's own readings: where two independent methods agree on real voices, the reading is
a measurement; where they do not, it needs work.

usage: tools/eval/.venv/bin/python tools/eval/praat_ref.py <vocalset|emvd|ptdb> [--jobs N] [--limit N] [--every N]
(Praat is slow: --every 3 reads one recording in three, which is plenty for the comparisons.)
output: data/eval/<set>.praat.jsonl
"""
import json
import os
import sys
from multiprocessing import Pool

import numpy as np
import parselmouth
from parselmouth.praat import call

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATA = os.path.join(ROOT, "data")
DIRS = {"vocalset": "vocalset", "emvd": "emvd", "ptdb": os.path.join("ptdb", "MIC")}


def files(name):
    out = []
    for d, _, fs in os.walk(os.path.join(DATA, DIRS[name])):
        for f in sorted(fs):
            if f.lower().endswith(".wav") and not f.startswith("._"):
                out.append(os.path.relpath(os.path.join(d, f), DATA))
    return sorted(out)


def female(path):
    p = path.lower()
    return "female" in p or "/f0" in p or "mic_f" in p


def band(freqs, psd, lo, hi):
    m = (freqs >= lo) & (freqs < hi)
    return float(psd[m].sum()) + 1e-20


def peak(freqs, psd, lo, hi):
    m = (freqs >= lo) & (freqs < hi)
    return float(psd[m].max()) + 1e-20


def measure(path):
    try:
        snd = parselmouth.Sound(os.path.join(DATA, path))
        if snd.n_channels > 1:
            snd = snd.convert_to_mono()
        out = {"path": path, "seconds": round(snd.duration, 3)}
        pitch = snd.to_pitch_cc(time_step=0.01, pitch_floor=60, pitch_ceiling=1100)
        f0 = pitch.selected_array["frequency"]
        voiced = f0 > 0
        out["voiced"] = round(float(voiced.mean()), 3)
        if voiced.sum() < 10:
            return out
        out["f0"] = round(float(np.median(f0[voiced])), 2)
        hnr = snd.to_harmonicity_cc(0.01, 60, 0.1, 4.5).values[0]
        out["hnr"] = round(float(np.mean(hnr[hnr > -100])), 2)
        pc = call(snd, "To PowerCepstrogram", 60, 0.005, 5000, 50)
        out["cpps"] = round(float(call(pc, "Get CPPS", "yes", 0.02, 0.0005, 60, 1100, 0.05, "Parabolic", 0.001, 0.05, "Straight", "Robust")), 2)
        pp = call(snd, "To PointProcess (periodic, cc)", 60, 1100)
        out["jitter"] = round(float(call(pp, "Get jitter (local)", 0, 0, 0.0001, 0.02, 1.3)) * 100, 3)
        out["shimmer"] = round(float(call([snd, pp], "Get shimmer (local)", 0, 0, 0.0001, 0.02, 1.3, 1.6)) * 100, 3)
        fm = snd.to_formant_burg(0.01, 5, 5500 if female(path) else 5000, 0.025, 50)
        times = pitch.xs()[voiced]
        for k in (1, 2, 3):
            v = np.array([fm.get_value_at_time(k, t) for t in times[:: max(1, len(times) // 200)]])
            v = v[np.isfinite(v)]
            out[f"F{k}"] = round(float(np.median(v)), 1) if len(v) else None
        # the long-term spectrum of the voiced stretches
        x = snd.values[0]
        fs = snd.sampling_frequency
        n = 2048 if fs < 30000 else 4096
        hop = n // 2
        win = np.hanning(n)
        psd = np.zeros(n // 2 + 1)
        cnt = 0
        for t in times[:: max(1, int(hop / fs / 0.01))]:
            i = int(t * fs) - n // 2
            if i < 0 or i + n > len(x):
                continue
            psd += np.abs(np.fft.rfft(x[i : i + n] * win)) ** 2
            cnt += 1
        if cnt:
            freqs = np.fft.rfftfreq(n, 1 / fs)
            db = lambda v: 10 * np.log10(v)
            out["alpha"] = round(db(band(freqs, psd, 1000, 5000) / band(freqs, psd, 50, 1000)), 2)
            out["spr"] = round(db(peak(freqs, psd, 2000, 4000) / peak(freqs, psd, 0, 2000)), 2)
            out["hammarberg"] = round(db(peak(freqs, psd, 0, 2000) / peak(freqs, psd, 2000, 5000)), 2)
            out["ringShare"] = round(db(band(freqs, psd, 2400, 3800) / band(freqs, psd, 50, 8000)), 2)
            out["rms"] = round(float(10 * np.log10(np.mean(x**2) + 1e-12)), 2)
        return out
    except Exception as e:  # one unreadable file must not stop the run
        return {"path": path, "error": str(e)[:200]}


def main():
    name = sys.argv[1]
    jobs = int(sys.argv[sys.argv.index("--jobs") + 1]) if "--jobs" in sys.argv else 10
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    every = int(sys.argv[sys.argv.index("--every") + 1]) if "--every" in sys.argv else 1
    paths = files(name)[::every][:limit]
    os.makedirs(os.path.join(DATA, "eval"), exist_ok=True)
    dst = os.path.join(DATA, "eval", f"{name}.praat.jsonl")
    with Pool(jobs) as pool, open(dst, "w") as f:
        for k, r in enumerate(pool.imap_unordered(measure, paths, chunksize=4)):
            f.write(json.dumps(r) + "\n")
            if (k + 1) % 200 == 0:
                print(f"{k + 1}/{len(paths)}", file=sys.stderr)
    print(f"{dst}: {len(paths)} recordings", file=sys.stderr)


if __name__ == "__main__":
    main()
