/**
 * Analyze's worker: the engine (its own instance), the codebook for each body asked for, and the
 * analysis, all off the main thread. Coach's microphone uses it too: for a live voice a chunk at
 * a time, and to measure each take of a lesson as the target the singer is compared with.
 */
import { initChimera, chimeraModule } from "../wasm/chimera.ts";
import type { BodyMix } from "../wasm/types.ts";
import type { VoiceTrack } from "./analyze.ts";
import type { Codebook } from "./codebook.ts";
import type { Mark } from "./demo.ts";
import type { Summary } from "../coach/compare.ts";
import type { Lesson } from "../coach/types.ts";

export type ToWorker =
  | { type: "analyze"; id: number; samples: Float32Array; sampleRate: number; body: BodyMix }
  /** render the demo for this body, then analyse it */
  | { type: "demo"; id: number; body: BodyMix }
  /** the last moments of a live voice: no progress reports; `alpha` is the singer's tract factor when known */
  | { type: "live"; id: number; samples: Float32Array; sampleRate: number; body: BodyMix; alpha?: number }
  /** sing each take of a lesson (at `notes[take.id]`, MIDI) and measure it */
  | { type: "targets"; id: number; body: BodyMix; lesson: Lesson; notes: Record<string, number> };

export type FromWorker =
  | { type: "progress"; id: number; stage: string; fraction: number }
  | { type: "done"; id: number; track: VoiceTrack; vowelOf: string[]; demo?: { samples: Float32Array; sampleRate: number; marks: Mark[] } }
  | { type: "targets"; id: number; targets: Record<string, Summary> }
  | { type: "error"; id: number; message: string };

const scope = self as unknown as { onmessage: ((e: MessageEvent<ToWorker>) => void) | null; postMessage(m: FromWorker, transfer?: Transferable[]): void };
const books = new Map<string, Codebook>();

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** nothing quieter than this is taken for singing at a live microphone (dB re full scale) */
const LIVE_FLOOR = -58;

async function book(body: BodyMix, say: (stage: string, fraction: number) => void): Promise<Codebook> {
  const { buildCodebook } = await import("./codebook.ts");
  const key = `${body.female},${body.child}`;
  let cb = books.get(key);
  if (!cb) {
    cb = await buildCodebook(body, (f) => say("Building the shapes to match against", f), tick);
    books.set(key, cb);
  }
  return cb;
}

const buffers = (track: VoiceTrack): Transferable[] => {
  const out: Transferable[] = [];
  for (const v of Object.values(track)) if (ArrayBuffer.isView(v)) out.push(v.buffer as ArrayBuffer);
  return out;
};

async function run(m: ToWorker): Promise<void> {
  const say = (stage: string, fraction: number) => scope.postMessage({ type: "progress", id: m.id, stage, fraction });
  if (m.type !== "live") say("Loading the voice model", 0);
  await initChimera();
  // these call into the engine as they load
  const { baseVowel } = await import("./codebook.ts");
  const { analyze } = await import("./analyze.ts");
  const cb = await book(m.body, say);
  const vowelOf = (): string[] => {
    const out: string[] = [];
    for (let b = 0; b < cb.nBase; b++) out.push(baseVowel(cb, b));
    return out;
  };

  if (m.type === "live") {
    const track = analyze(m.samples, m.sampleRate, cb, undefined, { alpha: m.alpha, floorDb: LIVE_FLOOR });
    scope.postMessage({ type: "done", id: m.id, track, vowelOf: [] }, buffers(track));
    return;
  }

  if (m.type === "targets") {
    const { renderTake } = await import("./demo.ts");
    const { EngineVoice } = await import("./render.ts");
    const { VoiceModel } = await import("../ui/analysis.ts");
    const { summarize } = await import("../coach/compare.ts");
    const fs = 48000;
    const vm = new VoiceModel(m.body, fs);
    const targets: Record<string, Summary> = {};
    for (let k = 0; k < m.lesson.takes.length; k++) {
      const take = m.lesson.takes[k];
      say("Measuring the takes", k / m.lesson.takes.length);
      await tick();
      const v = new EngineVoice(chimeraModule(), fs, m.body);
      const x = renderTake(v, vm, m.lesson, take, m.notes[take.id]);
      v.free();
      // the engine's own voice in this body: its tract factor is 1 by construction
      const s = summarize(analyze(x, fs, cb, undefined, { alpha: 1 }));
      if (s) targets[take.id] = s;
    }
    scope.postMessage({ type: "targets", id: m.id, targets });
    return;
  }

  let demo: { samples: Float32Array; sampleRate: number; marks: Mark[] } | undefined;
  let samples: Float32Array, sampleRate: number;
  if (m.type === "demo") {
    const { renderDemo } = await import("./demo.ts");
    say("Singing the demo", 0);
    await tick();
    demo = renderDemo(chimeraModule(), m.body);
    samples = demo.samples;
    sampleRate = demo.sampleRate;
  } else {
    samples = m.samples;
    sampleRate = m.sampleRate;
  }
  const track = analyze(samples, sampleRate, cb, say);
  scope.postMessage({ type: "done", id: m.id, track, vowelOf: vowelOf(), demo }, buffers(track));
}

/** one request at a time, in the order they came (a live chunk must not overtake a codebook being built) */
let queue: Promise<void> = Promise.resolve();
scope.onmessage = (e) => {
  queue = queue.then(() => run(e.data).catch((err) => scope.postMessage({ type: "error", id: e.data.id, message: err instanceof Error ? err.message : String(err) })));
};
