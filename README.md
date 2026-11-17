# CHIMERA Voice Coach

A fork of [CHIMERA](https://github.com/jamesondh/chimera-vocal-synth) (Jameson Hodge's
physical-modeling voice synthesizer, MIT) for a singer who learns by seeing: it **shows vocal
technique on a cutaway head while singing it**, and it **shows how a recording was sung**.
Everything under "CHIMERA" below is the original project, unchanged in spirit; this section is
what the fork adds.

## What the fork adds

- **Coach** (the first tab): 13 lessons in three groups. *Foundation*: breath support, cord
  closure, chest/head/mix. *Tone*: twang, larynx height, soft palate, vowel shapes, vowels on high
  notes, placement, tongue root. *Rock tools*: belt, grit and rasp, vibrato. Each lesson says what
  is physically happening, how to find it in your own body and how to practise it, and has two to
  five **takes**: the same notes sung different ways (aim for / avoid / compare). Pressing a take
  sings it through the engine, with the parts involved marked on the head, where it is felt
  glowing, readouts chosen for the lesson, the vocal folds from above and the spectrum. **Compare
  all** sings the takes one after another; **Loop** repeats one to sing along with; **Key** moves
  everything to where your voice sits.
- **Mic** (in Coach): sing a take back and see yourself beside it. While the take sings, the
  microphone waits; when it stops, your own voice drives the head, the folds and the spectrum,
  and four scales (drive, ring, air, grit) show the take's reading, yours now and your last go,
  with a line or two on what to change ("Less ring than the take: narrow the funnel…", "About 40
  cents flat"). With **Loop** on, the take and you alternate; with **Compare all**, you answer
  each take in turn, and a table keeps your go at every take, so you can see whether your "no
  twang" and your "twang" differ the way the takes do. Nothing is recorded or sent anywhere.
- **Analyze**: open a recording (a vocal stem, an a cappella, yourself) and the head sings along
  with it. A timeline shows the pitch, the vowel, how hard the voice is driven, the ring, the air,
  the grit and the level; click to move, drag to loop a phrase, slow it to 75 or 50 % at pitch,
  and fade between the recording and the synthesizer singing what was measured. **Demo** analyses
  the synthesizer singing Coach's own takes, whose settings are known, so the lanes can be read
  against the truth first.
- **Full tracks**: with **Full track** on, the vocal is isolated from the band first by
  [Demucs](https://github.com/facebookresearch/demucs), run locally by the dev server. It needs a
  one-time `bun run setup:separate` (PyTorch and Demucs into `tools/separate/.venv`: 5.3 GB on a
  machine where PyTorch brings its GPU build, less on a CPU-only one; the model's weights, 80 MB,
  come from Meta's servers on first use). Nothing is uploaded anywhere. On an NVIDIA GPU a song
  takes a few seconds; on a CPU, roughly its own length.
- The engine's voice gains **distortion** (`VoiceSource.distortion`): irregular fold cycles, from
  a subharmonic rattle to noise. At 0 the voice is bit-identical to upstream's.

### What Analyze measures, and what it only draws

It works from the sound alone. [docs/validation.md](docs/validation.md) has how each reading was
checked on real singers and how far off it can be; [docs/datasets.md](docs/datasets.md) lists the
openly licensed recordings used (none are in this repository).

- **Measured, and checked**: pitch (3.8 cents from the annotators' own measurement over 29,000
  sung notes; 96 % within 50 cents), vibrato (rate within 0.1 per second and extent within 10 % on
  tones with a set vibrato), level, and the vowel's resonances F1 and F2 (within about 4 % for F1
  on low notes, 9 % up to 350 Hz, 15 % by 440 Hz: the higher the note, the rougher).
- **Named from the measurement**: the vowel, as EE, EH, AH, OH or OO, by where trained singers
  put each. Right three times in four; OH is the weak one (heard as AH or OO half the time).
  "AH/OH" means it lies between; "?" means the note is too high to tell (above about 550 Hz).
- **Scales fitted to real singing**: drive, ring, air and grit are each fitted to recordings of
  20 trained singers and 27 metal vocalists whose technique is known, and scored with the singer
  left out: air tells breathy from straight tone 89 % of the time, drive tells belt and forte
  from soft singing 82 %, ring 79 %, grit tells fry and distortion from ordinary singing 96 %.
  Within one voice they do better (88 to 100 %): compare a singer with themself first.
- **Drawn, not measured**: the tongue, jaw and lips are a shape of the model that gives the
  measured F1 and F2 (a picture of the vowel, not an X-ray of the singer); the folds are the
  model's, driven to read the same on the scales; the twang funnel narrows with the ring and the
  false folds close in with the grit because that is how the model makes those sounds.
- **Not read at all**: consonants, nasality, larynx height, chest or head register, and whether
  twang or simply driving harder made the ring. Drive is not fold closure: both loudness and
  firmer closure raise it (against a laryngograph it follows real fold contact only weakly).

### Run it

Open <https://bkrabach.github.io/chimera-voice-coach/>: Coach, Mic and Analyze of a vocal on its
own run in the browser, and the audio never leaves it. Splitting a full track into vocal and band
does not run there (it needs Python and Demucs); for that, run it on your own machine:

```sh
bun install
bun run dev              # builds the wasm, then http://127.0.0.1:5317
bun run setup:separate   # once, only for full tracks (needs uv and ffmpeg)
```

A lesson's advice is general voice science, not a replacement for a teacher, and nothing in the
grit lesson is worth a sore throat.

---

# CHIMERA

A physical-modeling voice synthesizer in the browser. Every sound comes from a simulated
airway (lungs, vocal folds or syrinx, a branched vocal tract, lips, nose), not from samples.
The engine is Rust, compiled to WebAssembly for an AudioWorklet; the same code runs natively
for tests and the `chimera` CLI.

## Vision & scope

1. **One instrument**: a physically modeled voice (lungs, vocal folds, throat, mouth). No
   samples, no neural audio.
2. **The web app is the primary surface**: anyone should be able to make songs in it without
   an LLM's help. Mobile is the likely next surface. The plugin (CLAP/VST3/AU) still ships, but
   it's secondary.
3. **As realistic as we can make it**: the main push is to see how close the simulation gets to
   a real voice. The robotic, Vocaloid-like sound people like today stays playable as a preset
   ([#93](https://github.com/jamesondh/chimera-vocal-synth/issues/93)).
4. **Languages enter through one shared front-end design**, not one-off hacks. Each needs a
   native speaker's check and must leave English unchanged.
5. **The design language (the vector display) is settled**; the look within it can still evolve.
6. **Nothing copyrighted in git**; MIT; a deterministic, real-time-safe engine.
7. **Not now**: a DAW or sequencer, a light theme, MPE, multi-voice dialogue.
8. **This fork** adds one purpose to upstream's: teaching a singer. Coach and Analyze are in
   scope here; the list above still governs the voice itself.

## What it does

- **Play**: drag the tongue, lips and jaw in a live cutaway of the head; vowel pad, encoders,
  computer keyboard and Web MIDI.
- **Speak**: English text (CMUdict with a letter-to-sound fallback) or IPA, turned into
  gestures and prosody, with the gestural score and a consonant chart on screen. In IPA mode a
  notice under the box lists the symbols and marks the voice doesn't say (`chimera render speech`
  prints the same as warnings).
- **Sing**: type words and the **Sing** button sings them to a tune picked by its mood, each line
  fitted to a phrase of it (Tempo and Key on the Voice screen); **Record video** sings it again into a
  9:16 clip to share. The keys sing the same words a syllable at a time, legato or not, onto a
  pitch roll; consonants land before the beat. Lyrics can be English, Korean (Hangul: one block per
  note, with Korean sound rules) or Russian; each language is a front end
  ([docs/language-front-ends.md](docs/language-front-ends.md)).
- **Beatbox**: pads and a step sequencer, every drum an articulatory gesture.
- **Bestiary**: songbird (two-voice syrinx), seal, alligator and elephant.
- **Duet** (`?show=<id>`): two 3D heads replay a pre-rendered song.

Male, female and child bodies blend continuously. Everything on screen animates from live
engine state: pressure in the airway, airflow, the vocal folds, spectra and formants.

## Run it

Needs Rust with the `wasm32-unknown-unknown` target, and Bun.

```sh
bun install
bun run dev        # builds the wasm, then Vite on 127.0.0.1:5317
bun run test       # wasm build, cargo test --workspace, bun test tests
```

The AudioWorklet needs a secure context, so open it on localhost or over HTTPS (for example
`tailscale serve`). Vercel builds it with `vercel.json`; GitHub Pages builds this fork with
`.github/workflows/pages.yml`.

Offline renders and measurement:

```sh
cargo run --release -p chimera-cli -- render speech|text|song|notes|beatbox|creature|vowels …
cargo run --release -p chimera-cli -- diagnose       # nasal leakage, formants, bandwidths, pitch
cargo run --release -p chimera-cli -- compare csd    # against a real singer (docs/csd-comparison.md)
cargo run --release -p chimera-cli -- compare tsp    # against 23 real speakers (docs/speech-comparison.md)
bun tools/spectrogram.ts in.wav out.png
bun tools/musicxml-to-notes.ts score.mxl P1 --out p1.json   # a score's part → `render notes` melody
```

## Docs

- [docs/architecture.md](docs/architecture.md): the acoustic model (FDTD airway, sources,
  anatomy, gestures), and its [references and credits](docs/architecture.md#references-and-credits).
- [docs/rust-engine.md](docs/rust-engine.md): the engine's real-time and determinism contract,
  and the browser boundary.
- [docs/ui-redesign.md](docs/ui-redesign.md) and [docs/mockups/](docs/mockups/): the vector
  display look.
- [docs/csd-comparison.md](docs/csd-comparison.md): scoring the voice against the Children's
  Song Dataset.
- [docs/speech-comparison.md](docs/speech-comparison.md): scoring the speech against real
  speakers, phone by phone (the TSP speech database).
- [docs/russian.md](docs/russian.md): how Russian text is read, and what is approximate.
- [docs/hill-climb/](docs/hill-climb/): the rules and log for tuning the voice one measured
  step at a time.
- [docs/voice-coach.md](docs/voice-coach.md): how Coach, the microphone and Analyze work.
- [docs/validation.md](docs/validation.md): how right Analyze is, checked on real singers, and
  [docs/datasets.md](docs/datasets.md): the open recordings that was done with, and their credits.

Contributing: see [CONTRIBUTING.md](CONTRIBUTING.md). Agents: see [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE). Bundled third-party files keep their own licenses: the CMU Pronouncing
Dictionary ([public/data/CMUDICT-LICENSE.txt](public/data/CMUDICT-LICENSE.txt)) and the fonts
([public/fonts/](public/fonts/)).
