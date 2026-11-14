#!/usr/bin/env bash
# The whole evaluation, start to finish: run Analyze over the labelled recordings, fit the scales,
# and print the report docs/validation.md is written from. About five minutes on 16 cores, after
# the one-off Praat pass (about 40 minutes: it reads the datasets, not Analyze, so it is kept).
#
#   tools/data/fetch.sh                      the recordings (once)
#   python3 -m venv tools/eval/.venv && tools/eval/.venv/bin/pip install -r tools/eval/requirements.txt
#   tools/eval/run.sh [--write]              --write also updates src/analyze/scales.generated.json
set -euo pipefail
cd "$(dirname "$0")/../.."
PY=tools/eval/.venv/bin/python
LOG=data/eval/log
mkdir -p "$LOG"
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1

shards() { # set, n, extra flags…
  local set="$1" n="$2"; shift 2
  rm -f data/eval/"$set".[0-9]*.jsonl data/eval/"$set".frames.[0-9]*.jsonl
  for i in $(seq 0 $((n - 1))); do bun tools/eval/extract.ts "$set" --shard "$i/$n" "$@" > "$LOG/$set.$i.log" 2>&1 & done
}

echo "Analyze over VocalSet, EMVD and PTDB-TUG…"
shards vocalset 10 --frames
shards emvd 4
shards ptdb 2 --frames
wait

if [ ! -s data/eval/vocalset.praat.jsonl ]; then
  echo "Praat over VocalSet and EMVD (slow, once)…"
  $PY tools/eval/praat_ref.py vocalset --jobs 9 --every 3 > "$LOG/praat-vocalset.log" 2>&1
  $PY tools/eval/praat_ref.py emvd --jobs 9 --every 2 > "$LOG/praat-emvd.log" 2>&1
fi

echo "formants beside Praat's; fold contact from the laryngograph…"
rm -f data/eval/formants.*.jsonl
for i in 0 1 2 3 4 5; do bun tools/eval/formant-check.ts --shard "$i/6" > "$LOG/formants.$i.log" 2>&1 & done
$PY tools/eval/egg.py > "$LOG/egg.log" 2>&1 &
wait

$PY tools/eval/fit.py "$@"
$PY tools/eval/report.py --json data/eval/report.json
$PY tools/eval/formant_report.py
