#!/usr/bin/env python3
"""Isolate the vocal from a full track with Demucs (htdemucs).

usage: separate.py IN OUT.wav

IN is anything ffmpeg can read. OUT is the vocal alone: 44.1 kHz, 16-bit, stereo. The model's
weights (about 80 MB) are fetched from Meta's servers the first time and kept in TORCH_HOME.
Runs on the GPU when PyTorch can see one, else on the CPU (roughly the length of the song).
"""
import os
import subprocess
import sys
import tempfile


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    src, dst = sys.argv[1], sys.argv[2]

    import soundfile as sf
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "in.wav")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-ac", "2", "-ar", "44100", "-f", "wav", wav], check=True)
        audio, rate = sf.read(wav, dtype="float32", always_2d=True)

    model = get_model("htdemucs")
    model.eval()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    mix = torch.from_numpy(audio.T.copy())[None]  # [1, channels, samples]
    ref = mix.mean(1)
    mean, std = ref.mean(), ref.std() + 1e-8
    with torch.no_grad():
        stems = apply_model(model, (mix - mean) / std, device=device, split=True, overlap=0.25, progress=False)[0]
    vocals = (stems[model.sources.index("vocals")] * std + mean).cpu().numpy().T
    sf.write(dst, vocals, rate, subtype="PCM_16")
    print(f"vocals: {vocals.shape[0] / rate:.1f} s on {device}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
