# CHIMERA Voice Coach

A physical-modeling voice synthesizer: a Rust engine (wasm in an AudioWorklet, native for tests
and the CLI) under a React UI. This is a fork of jamesondh/chimera-vocal-synth (remote `upstream`,
never pushed to) that adds Coach and Analyze for a singer. See the README.

## Working here

- Do what was asked, the simplest way. Side work nobody asked for (experiments, tooling, paid
  runs) is a proposal with its cost. If the work grows well past the estimate, stop and say so.
- Weigh every feature against README → Vision & scope; anything outside it is a proposal with
  its cost, not work to do.
- Before repeating or reversing earlier work, read its history (`git log -- <path>`, `git log -S`).
- Commit small. The subject names what changed and the trap, in searchable words; the body gives
  the why, what you ruled out, what you ran (with numbers) and what you didn't test.
- Keep each fixed bug's reproduction as a test.
- PRs follow `CONTRIBUTING.md`: the body is written top-down, with evidence, and ends with the
  model and harness that wrote it.
- Code outranks this file: fix the file when they disagree. When something breaks unnoticed, add
  a rule here, with a check.

## Map

- `crates/chimera/`: the engine (no I/O). `crates/chimera-wasm/`: the browser's C ABI.
  `crates/chimera-cli/`: `chimera render | compare csd | compare tsp | diagnose | calibrate`.
- `src/wasm/`: the UI's facade over the engine. `src/worklet/`: the AudioWorklet. `src/ui/`: React
  and the canvas renderers. `src/song/`: Sing's tunes, fitting words to them, clip recording.
- `src/coach/`: the lessons (`lessons.ts`: words and engine settings), the demo player, the
  callouts drawn on the head, the microphone (`mic.ts`: the singer's live voice; `compare.ts`:
  a go beside a take). `src/analyze/`: a recording → what was sung (`dsp.ts` pitch and
  harmonics, `formants.ts` and `vowels.ts` the resonances and the vowel named from them,
  `analyze.ts` the measuring, `interpret.ts` the 0..1 scales, `codebook.ts` the shapes drawn,
  `store.ts` playback and driving the engine, `worker.ts`). `tools/separate/`: the
  vocal isolator (Demucs) and the dev server's `/api/separate`.
- `tests/`: bun tests on the wasm build. `tools/`: e2e, layout lint, spectrogram, speech judges
  (`asr/` Whisper, `tsp/` the real speakers' data), and Analyze's evaluation on real singers
  (`data/fetch.sh` the open datasets, `eval/` the scripts; `eval/run.sh` runs them all).
- `docs/`: architecture, the engine contract (`rust-engine.md`), the UI look, the singer and
  speech judges, the hill-climb rules, and how a language plugs in (`language-front-ends.md`).

## Rules

- **The engine's contract** (`docs/rust-engine.md`): transcendental math only through
  `chimera::math`, no allocation while rendering, output independent of block size. `cargo test`
  enforces each.
- **The voice must hold at any device sample rate** (a Bluetooth headset runs the page at 16 kHz,
  and an airway simulated too slowly goes NaN: silence, no error). Check:
  `cargo test -p chimera --test engine the_voice_holds`.
- **Any change to the sound or the plans fails the golden tests, by design.** Re-bless with
  `CHIMERA_BLESS=1 cargo test --workspace --no-fail-fast`, run twice. Human-voice audio, plans
  (including the beat sounds' gestures and the beat player), the tract geometry and the human
  airway's transfer functions re-bless; see `crates/chimera/tests/golden/README.md` for the rest.
- **`*.generated.json` tables are regenerated (`chimera calibrate`, `tools/gen-*`), never edited.**
  Vowel calibration isn't bit-reproducible, so rerun it only when the formants should move.
- **`src/wasm/chimera.wasm` is a gitignored build product.** After a Rust change, `bun test tests`
  alone tests the old engine: use `bun run test`. Don't share a cargo `target/` between checkouts.
- **Gesture records are defined twice**, in `crates/chimera-wasm/src/lib.rs` and
  `src/wasm/wire.ts`. Change both and bump `LAYOUT_VERSION`.
- **The wasm loads before the UI.** A module that calls the engine at import must not be reachable
  from `src/main.tsx`'s static imports. Check: `bun tools/e2e.ts` against `bun run preview`.
- **DOM content flows in `.screen-body`, never absolutely positioned.** Check: `bun run lint:layout`.
- **Nothing copyrighted goes in git.** `public/shows/` is gitignored; never ship CSD audio or
  anything derived from it.
- **Voice tuning follows `docs/hill-climb/README.md`** and never edits its judges.
- **A lesson's take must do what its words say.** Its numbers were chosen by rendering and
  measuring it; after changing one, read `bun tools/coach-takes.ts` (what Analyze reads on every
  take) and run `bun test tests/coach.test.ts tests/compare.test.ts`.
- **Analyze's scales are fitted to real, labelled singing,** by `tools/eval/fit.py`, which writes
  `src/analyze/scales.generated.json` (regenerate, never edit). After touching what
  `src/analyze/` measures: `tools/eval/run.sh --write`, then update the numbers in
  `docs/validation.md` from its output, then `bun tools/coach-takes.ts` and
  `bun test tests/measure.test.ts tests/analyze.test.ts tests/compare.test.ts`. A change that
  only looks better on the synthesizer or on made-up signals is not an improvement: a formant fit
  that was three times closer on pulse-train vowels named real singers' vowels worse
  (docs/validation.md has it).
- **Say what is measured and what is drawn.** The pitch, vibrato, formants and scales are
  measured and checked; the mouth shape and the folds shown are the model's. Do not show a
  reading nothing has checked (larynx height, register and nasality were dropped for that), and
  do not word a scale as more than it is (drive is not fold closure).
- **Evaluation audio is openly licensed and never in git.** `data/` is ignored. A new dataset
  goes in `tools/data/fetch.sh` and `docs/datasets.md` with its license, checked on its own page;
  nothing non-commercial, nothing from released songs.
- **Downloads are on disk once.** `fetch.sh` deletes each archive as soon as it is unpacked (the
  archives were once 3.5 GB of 8.8 GB left behind). When an evaluation is finished and the disk
  is short, `data/` can go except `data/eval/` (the 40-minute Praat pass), and so can
  `target/debug`; `fetch.sh` and `cargo` bring them back. Check: `ls data/*.zip
  data/emvd/*.tar.xz` finds nothing.
- **The dev server watches only source.** A big folder that is not source (datasets, build
  output, a Python environment) goes in `unwatched` in `vite.config.ts`: with `data/` watched, a
  running dev server stopped answering when the datasets were unpacked and deleted under it.
- **A steady high note must not read an octave off.** The true period was once dropped from the
  pitch tracker's shortlist of candidates; `tests/measure.test.ts` keeps notes from 110 to 1047 Hz.
- **A measurement must survive a moving pitch.** Vibrato read as grit until each window was
  re-timed to a steady pitch (`HarmonicAnalyser.steady`); the test's vibrato case keeps it so.
- **The microphone must never hear the speakers as the singer.** It waits while a take sings and
  just after, and the engine it drives is muted. A change to the player's timing or to `mic.ts`
  is checked with a fake microphone (docs/voice-coach.md says how) and `bun test tests/compare.test.ts`.
- **This machine's Node is too old for Vite 8:** the scripts run Vite and tsc under Bun
  (`bunx --bun`). `tools/layout-lint.ts` takes `CHIMERA_CHROME=<path to a Chromium>` when
  Playwright's own revision is not installed.

## Checks

| When you touch | Run |
|---|---|
| anything | `bun run test` and `bun run typecheck` |
| `crates/chimera/` sound | re-bless goldens (above); `cargo run --release -q -p chimera --example bench` against the previous commit |
| `crates/chimera-wasm/`, `src/wasm/`, `src/worklet/`, `src/main.tsx` | `bun run build && bun run preview`, then `bun tools/e2e.ts` |
| `src/ui/`, `src/show/`, CSS | `bun run lint:layout` |
| `src/coach/`, `src/analyze/` | `bun test tests/coach.test.ts tests/analyze.test.ts tests/compare.test.ts tests/measure.test.ts`; `bun tools/coach-takes.ts`; `bun tools/layout-lint.ts --mode coach` and `--mode analyze` |
| what `src/analyze/` measures | also `tools/eval/run.sh --write` (needs `tools/data/fetch.sh` once), and `docs/validation.md` |
