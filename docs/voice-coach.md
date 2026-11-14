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
- **The singer's tract size** (the analysis's `alpha`) is not estimated per chunk, which would
  make every reading wander: it is sized from a few seconds of their own singing, averaged in,
  and kept in `localStorage` per body.

Tested with the browser's fake microphone fed a file (`--use-file-for-fake-audio-capture`): the
"No twang" take sung into the Twang lesson reads "Less ring than the take"; the Breathy take sung
half a semitone low into "Clean" reads "Airier than the take" and "About 50 cents flat";
`tests/compare.test.ts` checks that reading a voice in overlapping chunks gives the same summary
as reading it whole. It has not been tried with a real microphone and a real voice.

## Analyze

`analyze()` (`src/analyze/analyze.ts`) works at 16 kHz in 10 ms frames:

1. **Pitch** (`dsp.ts`): YIN's difference function gives each frame a few candidates; a path
   search picks one per frame or "unvoiced", paying for jumps.
2. **Harmonics**: the stretch around each voiced frame is re-timed so that its pitch is constant
   (`HarmonicAnalyser.steady`), then transformed. Without this a vibrato smears the upper
   harmonics into the gaps between them and reads as noise. Harmonic levels come from the middle
   five periods; what lies between the harmonics from all ten.
3. **Tract length**: one factor for the whole recording, the one that lets the plain shapes fit
   best (a singer's resonances against the model body's).
4. **Shape**: the harmonic levels are compared with the engine's transfer function for every shape
   in the codebook (`codebook.ts`: every calibrated vowel, blends of each pair, each at five
   larynx heights and three twang settings: 6,615 shapes), with the source's level and spectral
   slope fitted freely for each. Working on the harmonics as they are, it needs no formant peaks,
   which a high note's few harmonics do not show. The six best candidates per frame go to a second
   path search that charges for movement.
5. **Scales** (`interpret.ts`): closure from the fitted source slope; ring from the 2.4-3.8 kHz
   share over what the matched shape gives with an easy source; air from a soft slope, a strong
   first harmonic and hiss above 1.8 kHz; grit from what lies between the harmonics below 1.8 kHz.

While a recording plays, `store.ts` sends the engine the posture and source of the frame under
the playhead (`articAt`, `sourceAt`: the inverse of the calibration), so the head, the folds and
the spectrum are the engine's own, and its voice can be faded in against the recording.

### Known limits

- Calibrated on the engine's singing only. Real voices, rooms and separated stems add noise the
  scales have not seen.
- The shape is one of many that fit; larynx height and twang are weakly determined (a small price
  keeps them at rest unless the sound insists).
- Ring does not say whether twang or pressing made it. The head narrows the twang funnel with it.
- Heavy distortion can lose the pitch (the frame goes unvoiced) or read an octave high.
- No consonants, no nasality, one voice at a time (harmonies and doubled vocals confuse the pitch).

### Checking it

`bun tools/analyze-calibrate.ts [male|female]` renders about 50 notes with known settings as one
recording and prints what was read beside what was sung. `tests/analyze.test.ts` keeps the
essentials: pitch, vowel names, the order of the closure, grit and air scales, vibrato, and that
a vibrato is not grit.

## Full tracks

`tools/separate/separate.py` runs Demucs (`htdemucs`) and writes the vocal. On this project's
machine (an NVIDIA GB10) it split 34 s of sound in 11 s, the model's download and loading included.

One check of what the isolation costs the analysis (2026-11-14): the engine's "Daisy Bell" under a
synthetic band (bass, keys, hi-hat). Against the analysis of the clean vocal, the isolated vocal
gave 99 % of the sung frames, every pitch within a quarter tone, the same vowel name on 76 % of
them, and closure, ring, air and grit within 0.01 to 0.09 on their 0..1 scales. The unseparated
mix gave half the sung frames. A real band is harder than that one (distorted guitars sit where
the voice does, and backing vocals are voices too); this has not been measured.

The Vite plugin beside the script serves `GET /api/separate` (is the Python environment there?) and `POST /api/separate` (a track
in, a WAV out, one at a time). It exists only under the dev and preview servers; a static build
has no isolator and Analyze takes vocals only.
