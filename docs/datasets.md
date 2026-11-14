# Recordings used to check and tune Analyze

Analyze's scales are fitted to, and its readings checked against, recordings of real voices
([validation.md](validation.md)). All of them are published for open use under the licenses
below. **None of the audio is in this repository** or in anything built from it: `tools/data/fetch.sh`
downloads it into `data/`, which is git-ignored. What is in the repository is derived statistics
only: the scales' coefficients (`src/analyze/scales.generated.json`) and the sung vowels' middle
formants (`src/analyze/vowels.ts`).

No commercially released music was used anywhere: not to fit, not to check.

| Dataset | License | What it is | What it is used for here |
|---|---|---|---|
| **VocalSet** (the file `VocalSet11.zip`) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 20 professional singers (11 men, 9 women) singing scales, arpeggios, long tones and excerpts on five vowels in 17 techniques: belt, breathy, straight, vibrato, vocal fry, forte, pianissimo and more. 3,613 recordings, 10 hours. | Fitting the air, drive, ring and grit scales; the sung vowels' centres; every "labels" check. |
| **Annotated-VocalSet** | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Note-by-note annotations of VocalSet: each note's start, end, written pitch and measured pitch. | Checking pitch on 29,073 notes. |
| **EMVD 1.1** | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 27 metal vocalists: clear voice and four distortion techniques (black shriek, death growl, hardcore scream, grind inhale) plus effects. 1,068 recordings. | Fitting and checking the grit scale; checking that distorted singing is still heard as a voice. |
| **PTDB-TUG** (a subset: 4 speakers, 60 sentences each) | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) (contents: [DbCL 1.0](https://opendatacommons.org/licenses/dbcl/1-0/)) | Read speech with a laryngograph recording and reference pitch beside the microphone. | Checking pitch and voicing frame by frame; setting the drive scale beside real fold contact. |

## Credit

- **VocalSet**: Julia Wilkins, Prem Seetharaman, Alison Wahl and Bryan Pardo, "VocalSet: A Singing
  Voice Dataset", ISMIR 2018. <https://doi.org/10.5281/zenodo.1442513>
- **Annotated-VocalSet**: Behnam Faghih and Joseph Timoney, "Annotated-VocalSet: A Singing Voice
  Dataset", Applied Sciences 12(18), 2022. <https://doi.org/10.5281/zenodo.7061507>
- **EMVD**: Modan Tailleur, Julien Pinquier, Laurent Millot, Corsin Vogel, Mathieu Lagrange, Axel
  Marmoret and Bastien Pasdeloup, "Extreme Metal Vocals Dataset (EMVD)", version 1.1, Zenodo.
  <https://doi.org/10.5281/zenodo.17813678>. Described in Tailleur, Pinquier, Millot, Vogel and
  Lagrange, "EMVD dataset: a dataset of extreme vocal distortion techniques used in heavy metal",
  2024.
- **PTDB-TUG**: Gregor Pirker, Michael Wohlmayr, Stefan Petrik and Franz Pernkopf, "A Pitch
  Tracking Corpus with Evaluation on Multipitch Tracking Scenario", Interspeech 2011.
  <https://www.spsc.tugraz.at/databases-and-tools/ptdb-tug-pitch-tracking-database-from-graz-university-of-technology.html>

The second opinion is [Praat](https://www.praat.org) (Paul Boersma and David Weenink), run
through [Parselmouth](https://parselmouth.readthedocs.io) (Yannick Jadoul et al.), both GPL: they
are tools the evaluation runs, not part of the app.

## What the licenses ask, and how it is met

- **CC BY 4.0** (VocalSet, Annotated-VocalSet, EMVD): credit the authors, link the license, say
  if changes were made. The credits are above; the recordings are used unchanged (decoded and
  resampled for analysis) and are not redistributed.
- **ODbL 1.0** (PTDB-TUG): attribute; share any adapted *database* under the same license. No
  database derived from it is published here: only summary numbers in validation.md.

## Looked at and not used

- **Phonation Modes Dataset** (Proutskova et al.: sustained vowels sung breathy, neutral, flow
  and pressed): it would label the drive axis directly, but its license is non-commercial, so it
  was left out.
- Datasets built from commercially released songs, or offered for research only, were not
  considered.
- No open dataset was found that labels **twang**, **larynx height** or **register** in singing,
  or that pairs singing with images of the mouth. Those are the readings validation.md lists as
  unchecked or dropped.

Before adding a dataset: check its license page yourself, add it to `tools/data/fetch.sh` with
the license beside it, and to the table above.
