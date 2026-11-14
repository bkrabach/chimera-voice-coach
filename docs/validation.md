# How right Analyze is

What Analyze and Coach's microphone show comes from the sound alone. This page says how each
reading was checked, against what, and how far off it can be. Every number here is printed by a
script in `tools/eval/` from openly licensed recordings ([datasets.md](datasets.md)); `tools/eval/run.sh`
runs the lot in about five minutes. Last run: 2026-11-14.

Three kinds of check, strongest first:

- **Truth**: signals made so that the answer is known exactly (a tone with a set vibrato, a vowel
  with set formants, the synthesizer singing a shape whose resonances its geometry gives).
- **Labels**: real singers who were asked for a technique or a vowel (20 trained singers in
  VocalSet, 27 metal vocalists in EMVD), with the singer being scored always left out of whatever
  was fitted.
- **A second opinion**: Praat, the phonetician's standard tool, on the same recordings; and a
  laryngograph (electrodes on the neck) for what the folds were really doing.

## At a glance

| Reading | Kind | How it was checked | Result |
|---|---|---|---|
| Pitch | measured | 28,963 sung notes whose pitch the dataset's annotators measured | middle difference 3.8 cents; 96 % within 50 cents; 0.56 % an octave off |
| Notes found | measured | 29,073 annotated notes | 98.9 % of each note's middle read as sung |
| Vibrato rate and extent | measured | tones with a set vibrato | rate within 0.1 per second, extent within 10 % |
| Vibrato or not | measured | singers asked for vibrato or straight tone | told apart 91 % of the time (ROC area 0.91) |
| Formants F1, F2 | measured | shapes whose resonances are known | F1 off 4 % (to 200 Hz), 9 % (to 350 Hz), 15 % (to 440 Hz); F2 2 to 6 % (a man's body) |
| Vowel name | measured, then named | 1,989 recordings sung on one given vowel | 74.7 % right; AH, EE, EH 82 to 89 %; OH 44 % |
| Air | fitted scale | breathy against straight tone, singer held out | ROC area 0.89 (0.995 within one singer) |
| Drive | fitted scale | belt and forte against breathy and piano | 0.82 (0.88 within one singer) |
| Ring | fitted scale | the same two ends | 0.79 (0.85 within one singer) |
| Grit | fitted scale | vocal fry and metal distortion against ordinary singing | 0.96 (1.00 within one singer); distortion against clear voice 0.99 |
| Tongue, jaw, lips drawn | **drawn, not measured** | a shape of the model that gives the measured F1 and F2 | not checked against any real mouth |
| Folds drawn | **drawn, not measured** | the model's folds driven to read the same on the scales | drive follows real fold contact only weakly (rank correlation +0.1 to +0.5) |

ROC area: pick one recording of each kind at random; it is how often the scale puts them the
right way round. 0.5 is a coin toss, 1 is always.

## Pitch

`tools/eval/report.py pitch`.

- **Against the annotators' measurement** (Annotated-VocalSet gives each note's median pitch as
  its annotators measured it): over 28,963 notes the two differ by 3.8 cents in the middle, 80 %
  are within 10 cents and 95.9 % within 50; 0.56 % differ by an octave. Straight tone and belt
  2.5 to 2.9 cents; fast passages 5.5 to 6.4.
- **Notes found**: of the middle half of each of 29,073 annotated notes, 98.9 % of the frames
  were read as sung (lip trills 92 %, spoken rhythm 95 %).
- **Against the score** the same notes are 39 cents off in the middle: that is the singers, not
  the reading (they were not asked to be in tune with a piano).
- **Against Praat** on 3,613 recordings: rank correlation 0.99, middle difference 0.4 %.
- **Speech** (PTDB-TUG, 240 sentences, reference pitch from a laryngograph): of the frames the
  reference calls voiced, 27 % are read as not sung; of the rest 0.47 % are grossly wrong (over
  20 %); 3.2 % of unvoiced frames are read as sung. Analyze is cautious about what it calls a
  note: in speech it drops quiet voiced consonants and the edges of syllables. For sung notes see
  above.
- **Truth**: steady notes from 110 to 1047 Hz with three different spectra are read within 8
  cents (`tests/measure.test.ts`).

Found and fixed by these checks: steady notes above 330 Hz could read an octave or a twelfth low
(466 Hz as 233, 880 as 176), because the true period was dropped from the shortlist of candidates.
On real singers the fix took notes found from 97.4 to 98.9 % and octave slips against the score
from 1.79 to 1.55 %.

Where it still goes wrong: heavy distortion with no steady pitch is marked HARSH, not given a
note; two voices at once (harmonies, doubled vocals) confuse it; a note whose odd harmonics hold
under 2 % of its energy can read an octave high.

## Vibrato

- **Truth** (`tests/analyze.test.ts`): tones at 220 Hz swung ±36 cents at 5.8 per second, ±100 at
  5, ±80 at 6.5 and ±25 at 7.5 are read at their rate within 0.1 per second and their extent
  within 10 %, and the note's centre stays within 5 cents. The synthesizer's own vibrato (set to
  36 cents at 5.8) reads ±36 at 5.8.
- **Labels**: the share of a recording's frames with vibrato is 0.08 in the middle for straight
  tone and belt, 0.53 for "vibrato", 0.7 for long forte and soft notes; it tells vibrato from
  straight recordings with ROC area 0.91.
- The detector looks for a swing between 4.5 and 8 per second, 15 to 200 cents each way, over
  0.7 s: a slower wobble reads at 4.4 to 4.5; the first and last third of a second of a note
  have no reading.

Found and fixed: the extent read 25 to 35 % too large, because the note's centre was a median
over a window that is not a whole number of swings and so swung with the vibrato.

## Formants and the vowel

Formants are measured by linear prediction, the method Praat uses (`src/analyze/formants.ts`).

- **Against Praat** on 1,149 real recordings (`tools/eval/formant_report.py`): F1 differs by 0.6
  to 1.0 % in the middle, F2 by 0.5 to 0.7 %, F3 by 0.6 to 0.9 %; 92 to 99 % are within 10 %.
  The two are the same method, so this shows the implementation is right, not that the method is.
- **Against the truth** (`tools/eval/formant-truth.ts`), mean error (the middle case is about
  two thirds of it; single notes can be 25 to 40 % off):

  | Sung at | Pulse-train vowels, F1 / F2 | The synthesizer, a man's body, F1 / F2 | A woman's body, F1 / F2 |
  |---|---|---|---|
  | 98-196 Hz | 3.1 % / 1.0 % | 4.0 % / 2.3 % | (175-262 Hz) 5.7 % / 9.4 % |
  | 220-349 Hz | 9.1 % / 2.7 % | 8.7 % / 3.0 % | (294-440 Hz) 11.1 % / 10.3 % |
  | 370-440 Hz | 15.8 % / 7.4 % | 14.8 % / 6.4 % | (466-587 Hz) 14.8 % / 10.3 % |
  | 466-698 Hz | 13.1 % / 11.1 % | | |

  The error grows with the pitch because a sung note only samples the mouth's response at its
  harmonics, and the estimate is pulled toward the nearest one. Read F1 as "about", more so the
  higher the note. Above about 550 Hz the vowel is marked "?".
- **The vowel named** (`tools/eval/report.py vowel`): of 1,989 VocalSet recordings sung on one
  given vowel, the vowel named most often was the one asked for in 74.7 % (men 75.1 %, women
  74.1 %). AH 89 %, EE 84 %, EH 82 %, OO 75 %, OH 44 % (it is heard as AH 23 % and OO 25 % of
  the time: sung, the three sit close together). By pitch: 77 % up to 200 Hz, 72 % to 300, 79 %
  to 400, 68 % to 550, 5 of 12 above. The names' centres are the middle of where these same
  singers put each vowel; with the singer being named left out of the centres the figure is
  76.5 % for men and 75.1 % for women, and Praat's own formants give 75.9 % and 74.4 %: the limit
  is how differently singers shape a vowel, not the measurement. Where a vowel lies between two,
  both are shown ("AH/OH").

Tried and not kept: fitting the resonances to the harmonics' levels alone (discrete all-pole
modelling). On pulse-train vowels it was three times closer (F1 off 1 to 6 % where linear
prediction is off 3 to 16 %), on the synthesizer's singing no closer, and on real singers it named the vowel slightly less often
(73.9 % against 75.9 % for men). The error left comes from the voice's own source colouring the
spectrum, which no fit to the spectrum can separate.

**What is drawn from them**: the head shows a tongue, jaw and lip shape of the model that would
give the measured F1 and F2. Many shapes give the same two formants, and a real mouth is not the
model's. It is a picture of the vowel, not of the singer's mouth, and it has not been checked
against one (that needs MRI or ultrasound recordings, which no open singing dataset has).

## The four scales

Each scale is a small logistic model over two or three measures, fitted to recordings whose
technique is known (`tools/eval/fit.py` writes `src/analyze/scales.generated.json`). 0.5 on a
scale is the point half-way between the two kinds of singing it was fitted to tell apart.

| Scale | Measures | Fitted to tell | Singer held out | Within one singer (middle, worst) |
|---|---|---|---|---|
| Air | noise between the harmonics above 1.5 kHz; the first harmonic's lead over the second | breathy from straight tone (200 and 201 recordings, 20 singers) | 0.892 | 0.995, 0.77 |
| Drive | the source's slope; energy above 1 kHz over below; first harmonic's lead (less of it) | belt and forte from breathy and piano (1,093 and 1,083) | 0.821 | 0.884, 0.79 |
| Ring | the share of energy at 2.4-3.8 kHz; the strongest peak at 2-4 kHz over the strongest below | the same two ends | 0.789 | 0.850, 0.70 |
| Grit | noise between the harmonics below 1.5 kHz; a peak half-way between harmonics; first harmonic's lead (less of it) | vocal fry and metal distortion from ordinary singing (669 and 3,194, 47 singers) | 0.957 | 1.000, 0.56 |

Checks on recordings the scales were not fitted to tell apart:

- Grit, vibrato against straight tone: 0.55 (wanted 0.5: a vibrato is not grit).
- Grit, breathy against straight tone: 0.68 (wanted 0.5). This is a known leak: a very breathy
  voice has noise low down too, and about one breathy recording in six reads over half-way up
  the grit scale.
- Grit, EMVD's distortions against its clear voice: 0.99. Vocal fry against straight tone: 0.88.
- Drive, belt against straight tone: 0.83. Ring, belt against straight tone: 0.80.
- Air, pianissimo against forte: 0.78.

What each technique reads in the middle (VocalSet; EMVD at the bottom):

| Technique | Drive | Ring | Air | Grit |
|---|---|---|---|---|
| belt | 0.83 | 0.74 | 0.06 | 0.11 |
| forte (long tones) | 0.59 | 0.64 | 0.11 | 0.04 |
| vibrato | 0.68 | 0.65 | 0.17 | 0.08 |
| straight tone | 0.45 | 0.50 | 0.14 | 0.06 |
| pianissimo | 0.20 | 0.28 | 0.36 | 0.03 |
| breathy | 0.15 | 0.24 | 0.58 | 0.14 |
| vocal fry | 0.53 | 0.42 | 0.20 | 0.69 |
| metal distortion (EMVD: shriek, growl, scream) | 0.30-0.54 | 0.23-0.52 | (taken by grit) | 0.99 |
| clear voice (EMVD) | 0.34 | 0.39 | 0.46 | 0.13 |

On EMVD's distortion techniques, 93 to 98 % of the frames with sound are heard as a voice (a
note, or HARSH where there is no steady pitch); of the clear voice, none is marked HARSH.

### What the scales cannot do

- **They rank within a voice better than across voices** (0.88 to 1.00 against 0.79 to 0.96).
  Compare a singer with themself, and a take with your go at it, before comparing two singers.
- **Drive is not fold closure.** It is how strong the upper harmonics are, which both singing
  louder and closing the folds more firmly raise. Against a laryngograph on read speech
  (`tools/eval/report.py contact`, four speakers) it follows the share of each cycle the folds
  are in contact with a rank correlation of +0.24, +0.11, +0.39 and +0.49: related, weakly. The
  folds drawn are the model's, set to read the same on the scales.
- **Ring does not say what made it.** Twang raises it and so does driving harder; no open dataset
  labels twang, so the two cannot be pulled apart or checked. It also depends on the vowel: at
  the same effort EE and EH read about 0.6 and OO about 0.2 on trained singers' straight tone.
  Compare the same vowel.
- **Air reads a little on soft singing** (pianissimo 0.36) and on quiet, fast passages (0.4 to
  0.5): soft voices are airier, and the scale cannot tell that from a breathy tone on purpose.
- **Grit's floor**: the measure reads −34 dB on a mathematically perfect tone (what its analysis
  window leaks), and trained singers' clean notes read −31 to −33: clean voices are at the floor
  and are not told apart.
- **Larynx height, nasality and registers (chest, head, mix) are not read.** Nothing in the sound
  was found to tell them apart reliably, and they are no longer drawn or named in Analyze.
- **Isolated vocals** (a full track through the separator) have not been through these checks;
  the one measurement there is in [voice-coach.md](voice-coach.md).

## The synthesizer on the same scales

Coach's takes are the synthesizer, and at the microphone a singer is set beside what Analyze
reads on the take. `bun tools/coach-takes.ts` prints that for every take. On the man's body each
take reads as its words say: Breathy air 0.72 against Clean 0.07; Pressed drive 0.92 against
0.32; Twang ring 0.59 against 0.28; Edge and Full rasp grit 0.99 and 0.94 against 0.08; vibrato
at its set rate and extent. Clean takes read grit 0.06 to 0.20 (trained singers: 0.06).

Limits: on the woman's body the falsetto and the collapsing-breath takes do not read airy (0.02
and 0.13), and its EH takes with twang are named AH (the model's vowel is more open than a sung
EH). The grit scale is at its top for both Edge and Full rasp and does not order them. The
microphone's advice therefore only speaks of grit or air when the take or the singer is clearly
above "none" (`NONE` in `src/coach/compare.ts`).

## At the microphone

The microphone reads a live voice with the same analysis, a second and a half at a time, and
`tests/compare.test.ts` checks that reading in overlapping chunks gives the whole's answer. Real
singers played into the browser's fake microphone (one of VocalSet's men answering the Clean
take) get the advice their technique should: breathy singing "Airier than the take" and "Softer
than the take", belt "Driven harder" and "More ring", vocal fry "More rattle than the take", and
a straight tone nothing about air or rattle. A live room (a laptop microphone, its noise, a singer
answering in real time) has not been tried.

## Running it

```sh
tools/data/fetch.sh                      # the recordings: 6.5 GB under data/ (git-ignored)
python3 -m venv tools/eval/.venv && tools/eval/.venv/bin/pip install -r tools/eval/requirements.txt
tools/eval/run.sh                        # everything above; add --write to refit the scales
bun tools/eval/formant-truth.ts          # the formant table
bun tools/coach-takes.ts [male|female]   # the takes on the scales
bun test tests/measure.test.ts tests/analyze.test.ts tests/compare.test.ts
```

The first run reads the datasets with Praat as well (about 40 minutes); later runs reuse that.
