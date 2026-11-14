#!/usr/bin/env bash
# Real singing and speech with known labels, for checking and tuning Analyze (docs/datasets.md has
# what each is used for). Everything here is openly licensed; none of it goes in git: it lands in
# data/ (git-ignored). About 6.5 GB with the archives.
#
#   VocalSet                CC BY 4.0   https://doi.org/10.5281/zenodo.1442513
#     Wilkins, Seetharaman, Wahl & Pardo, "VocalSet: A Singing Voice Dataset", ISMIR 2018.
#     20 professional singers, 17 techniques (belt, breathy, vocal fry, straight, vibrato, ...), vowels labelled.
#   Annotated-VocalSet      CC BY 4.0   https://doi.org/10.5281/zenodo.7061507
#     Faghih & Timoney, 2022. Note-level annotations (onset, offset, pitch) of VocalSet.
#   EMVD 1.1                CC BY 4.0   https://doi.org/10.5281/zenodo.17813678
#     Tailleur, Pinquier, Millot, Vogel, Lagrange, Marmoret & Pasdeloup, "Extreme Metal Vocals
#     Dataset (EMVD)". 27 singers, clear voice and four distortions.
#   PTDB-TUG (a subset)     ODbL 1.0 (contents: Database Contents License)
#     https://www.spsc.tugraz.at/databases-and-tools/ptdb-tug-pitch-tracking-database-from-graz-university-of-technology.html
#     Pirker, Wohlmayr, Petrik & Pernkopf, "A Pitch Tracking Corpus with Evaluation on Multipitch
#     Tracking Scenario", Interspeech 2011. Microphone, laryngograph and reference pitch.
#
# Usage: tools/data/fetch.sh [vocalset] [annotated] [emvd] [ptdb]   (no argument: all)
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p data
want() { [ $# -eq 0 ] && return 0; local x="$1"; shift; for a in "$@"; do [ "$a" = "$x" ] && return 0; done; return 1; }
ALL=("$@")
has() { [ ${#ALL[@]} -eq 0 ] || want "$1" "${ALL[@]}"; }
get() { # url, destination
  [ -s "$2" ] && { echo "have $2"; return; }
  echo "fetching $2"
  curl -L --fail --retry 3 -C - -o "$2.part" "$1" && mv "$2.part" "$2"
}

if has vocalset; then
  get "https://zenodo.org/records/1442513/files/VocalSet11.zip?download=1" data/VocalSet11.zip
  [ -d data/vocalset ] || { mkdir -p data/vocalset && unzip -q -o data/VocalSet11.zip -d data/vocalset; }
fi
if has annotated; then
  get "https://zenodo.org/records/7061507/files/Annotated%20VocalSet.zip?download=1" data/AnnotatedVocalSet.zip
  [ -d data/vocalset-annotated ] || { mkdir -p data/vocalset-annotated && unzip -q -o data/AnnotatedVocalSet.zip -d data/vocalset-annotated; }
fi
if has emvd; then
  mkdir -p data/emvd
  for f in metadata_files.csv metadata_singers.csv split_kfolds.csv; do get "https://zenodo.org/records/17813678/files/$f?download=1" "data/emvd/$f"; done
  get "https://zenodo.org/records/17813678/files/audio.tar.xz?download=1" data/emvd/audio.tar.xz
  [ -d data/emvd/audio ] || tar -xJf data/emvd/audio.tar.xz -C data/emvd
fi
if has ptdb; then
  # four speakers (two women, two men), the first 60 sentences of each: microphone, laryngograph, reference pitch
  base="https://www2.spsc.tugraz.at/databases/PTDB-TUG/SPEECH%20DATA"
  for spk in F01 F02 M01 M02; do
    g=$([ "${spk:0:1}" = F ] && echo FEMALE || echo MALE)
    for kind in MIC LAR REF; do
      mkdir -p "data/ptdb/$kind/$spk"
      list=$(curl -s --fail "$base/$g/$kind/$spk/" | grep -o 'href="[^"?/][^"]*"' | sed 's/href="//;s/"//' | grep -E '\.(wav|f0)$' | sort | head -60)
      for f in $list; do [ -s "data/ptdb/$kind/$spk/$f" ] || curl -s --fail --retry 3 -o "data/ptdb/$kind/$spk/$f" "$base/$g/$kind/$spk/$f"; done
    done
    echo "ptdb $spk: $(ls data/ptdb/MIC/$spk | wc -l) sentences"
  done
fi
du -sh data
