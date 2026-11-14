# Voice Coach: how it works

What this fork adds to CHIMERA, for whoever changes it next. The README says what it is for.

## Coach

A lesson (`src/coach/lessons.ts`) is words plus **takes**. A take is a posture and a voice source
for the engine: a calibrated vowel, optionally blended toward another, nudged (`Shape`), and
`VoiceSource` settings on top of `BASE_SOURCE`. `player.ts` sings it live (posture and source
first, then the breath, then the pattern's notes on timers); `src/analyze/demo.ts` sings the same
take offline. `callouts.ts` draws the take's parts and zones over the head and picks the four
readouts.

The numbers were chosen by rendering and measuring (the engine at 4x real time, then spectra):

| Setting | What it measurably does (adult male, "ah", A3) |
|---|---|
| `tension` 0.05 → 0.95 | the source's slope goes from −13 to −2 dB per octave |
| `breathiness` 0.85 | at the source the first harmonic stands 9 dB over the second; hiss above 2 kHz |
| `epilarynx` 0.9 (twang) | F4 falls about 400 Hz toward F3; 2.4-3.8 kHz up about 3 dB (7 with the larynx raised) |
| `larynx` ±1 cm | every formant the other way, by 3 to 10 % |
| `velum` 0.6 | the formant pattern is replaced by the nasal one |
| `distortion` 0.36 / 0.56 | a subharmonic an octave down / noise between the harmonics |
| `ventricular` | narrows the false folds in the drawing and the tube; little change to the sound by itself |

Two things the model does not do by itself, and how the lessons handle it: twang alone is subtler
than in a real throat, so the twang takes also brighten the source (a narrowed epilarynx does
help the folds close more sharply, so this is the right direction); and the false folds do not
vibrate, so the grit takes get their sound from `distortion` (irregular fold cycles) while the
false folds are drawn in. The grit lesson says so.

### The microphone

`src/coach/mic.ts`. A small AudioWorklet (`src/worklet/tap.ts`) hands the microphone's samples to
the page; the last eight seconds are kept in memory and nothing else is. Every 100 ms the last
1.6 s go to the analysis worker (`type: "live"`), which reads them exactly as it reads a
recording; the frames whose windows are full (all but the last 100 ms) are new information, and
the newest drives the engine in silence, so the head, the folds and the spectrum are the
singer's. The browser's echo cancelling, noise suppression and gain control are switched off:
they flatten what is being measured.

- **Turns.** While a take sings, the microphone is ignored (it would hear the speakers), and
  for 350 ms after (the room). `player.ts` calls `hooks.beforeTake` so the engine is the take's
  again before its first note, and awaits `hooks.afterTake` between takes of a loop or a tour:
  that is the singer's go, ended by 0.6 s of silence, or skipped if nothing is sung in 3.8 s.
- **A go** is a phrase of at least half a second of singing, summed up as medians
  (`compare.ts`: `Gather`, `Summary`) and kept per take.
- **The target** is the take itself, rendered offline and read by the same analysis
  (`type: "targets"`), so the two are on the same scales. `advise()` names the one or two scales
  furthest apart (0.18 or more), and the pitch when the take holds one note (octaves ignored).
  Grit and air are only spoken of when the take or the singer is clearly above "none" (`NONE` in
  `compare.ts`: grit 0.5, air 0.3): clean voices read anywhere below that, the synthesizer's a
  little higher than a trained singer's, and a difference down there means nothing.

Tested with the browser's fake microphone fed a file (`--use-file-for-fake-audio-capture`): the
"No twang" take sung into the Twang lesson reads "Less ring than the take"; the Breathy take sung
half a semitone low into "Clean" reads "Airier than the take" and "About 50 cents flat";
`tests/compare.test.ts` checks that reading a voice in overlapping chunks gives the same summary
as reading it whole.

With real singers played into the fake microphone (one of VocalSet's men, three seconds each,
answering the Clean take of Cord closure): his breathy singing reads "Airier than the take" and
"Softer than the take"; his belt "Driven harder" and "More ring"; his vocal fry "More rattle than
the take"; his straight tone no word about air or rattle. Prepare such a file without re-encoding
tricks: a first attempt that joined the excerpt to generated silence added enough noise to read as
rattle. What has not been tried is a live room: a laptop microphone, its noise, and a singer
answering in real time.

## Analyze

`analyze()` (`src/analyze/analyze.ts`) works at 16 kHz in 10 ms frames. What it measures is
checked on real singers in [validation.md](validation.md).

1. **Pitch** (`dsp.ts`): YIN's difference function, on the sound below 2 kHz, gives each frame a
   few candidate periods; a path search picks one per frame or "unvoiced", paying for jumps and a
   little for each octave down (which is what picks the note itself out of its multiples).
2. **Formants** (`formants.ts`): linear prediction by Burg's method, the way Praat does it (the
   formant ceiling follows the body: 5000 Hz for a man, 5500 for a woman).
3. **Harmonics**: the stretch around each voiced frame is re-timed so that its pitch is constant
   (`HarmonicAnalyser.steady`), then transformed. Without this a vibrato smears the upper
   harmonics into the gaps between them and reads as noise. Harmonic levels come from the middle
   five periods; what lies between the harmonics from all ten. From them: the source's slope (the
   harmonics with the measured formants taken out), the first harmonic's lead over the second,
   the energy above 1 kHz over below, the share at 2.4-3.8 kHz, noise between the harmonics below
   and above 1.5 kHz, and a peak half-way between harmonics (a subharmonic).
4. **Vowel** (`vowels.ts`): the nearest of five sung vowels by F1 and F2, whose centres are the
   middle of where VocalSet's singers put each; the next nearest too when it lies between.
5. **Vibrato**: a swing of the pitch that repeats 4.5 to 8 times a second over 0.7 s; the note's
   centre is the mean over two whole swings.
6. **Scales** (`interpret.ts`): air, drive, ring and grit are logistic models over those measures,
   fitted to labelled singing by `tools/eval/fit.py`, which writes `scales.generated.json`.
7. **The shape drawn** (`codebook.ts`): the model's posture, among every calibrated vowel and the
   blends between them (441 shapes), whose first two resonances are nearest the measured F1 and
   F2. It is an illustration: nothing else is taken from it.

While a recording plays, `store.ts` sends the engine the posture and a source that reads about the
same on the scales (`articAt`, `sourceAt`), so the head, the folds and the spectrum are the
engine's own, and its voice can be faded in against the recording.

### Known limits

See [validation.md](validation.md) for the numbers. In short:

- The scales rank techniques within one voice better than across voices.
- Drive is how strong the upper harmonics are, not fold closure; ring does not say whether twang
  or driving harder made it, and depends on the vowel.
- F1 is rougher the higher the note; above about 550 Hz the vowel is not named.
- The mouth and the folds drawn are the model's, fitted to the measurements, not the singer's.
- Larynx height, nasality and register are not read. No consonants. One voice at a time
  (harmonies and doubled vocals confuse the pitch). Heavy distortion with no steady pitch is
  marked HARSH and gets no note.

### Checking it

- `tools/eval/run.sh`: Analyze over the open datasets, the scales fitted, and the report
  validation.md is written from (`tools/data/fetch.sh` gets the recordings first).
- `bun tools/coach-takes.ts [male|female]`: what Analyze reads on every take of every lesson.
- `bun tools/analyze-calibrate.ts [male|female]`: about 50 notes sung by the engine with known
  settings, and what was read beside what was sung.
- `bun tools/eval/formant-truth.ts`: formants against vowels whose resonances are known.
- `tests/measure.test.ts` (no engine: pitch, formants, vowel names, noise, the scales file),
  `tests/analyze.test.ts` (the engine's singing read back; a known vibrato) and
  `tests/compare.test.ts` (the singer beside the take).

## Full tracks

`tools/separate/separate.py` runs Demucs (`htdemucs`) and writes the vocal. On this project's
machine (an NVIDIA GB10) it split 34 s of sound in 11 s, the model's download and loading included.

One check of what the isolation costs the analysis (2026-11-14): the engine's "Daisy Bell" under a
synthetic band (bass, keys, hi-hat). Against the analysis of the clean vocal, the isolated vocal
gave 99 % of the sung frames, every pitch within a quarter tone, the same vowel name on 76 % of
them, and the four scales within 0.01 to 0.09 (measured with the earlier scales, before they were
refitted to real singers; not repeated since). The unseparated
mix gave half the sung frames. A real band is harder than that one (distorted guitars sit where
the voice does, and backing vocals are voices too); this has not been measured.

The Vite plugin beside the script serves `GET /api/separate` (is the Python environment there?) and `POST /api/separate` (a track
in, a WAV out, one at a time). It exists only under the dev and preview servers; a static build
has no isolator and Analyze takes vocals only.
