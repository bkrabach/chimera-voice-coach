/**
 * Analyze's demo: the engine sings a dozen of Coach's takes, whose settings are known, so the
 * lanes can be read against what was actually sung before trusting them on a real recording.
 * Import only after the engine has loaded.
 */
import { VoiceModel } from "../ui/analysis.ts";
import { nearestBody, type BodyMix } from "../ui/body.ts";
import { BASE_SOURCE, HOME, lessonById, midiHz, patternSteps, REGISTER } from "../coach/lessons.ts";
import { mergeShape, resolveShape } from "../coach/shape.ts";
import type { Lesson, Take } from "../coach/types.ts";
import type { VoiceSource } from "../wasm/types.ts";
import { EngineVoice, concat } from "./render.ts";

export interface Mark {
  t0: number;
  t1: number;
  label: string;
}

/** [lesson, take] in the order sung */
const PROGRAMME: [string, string][] = [
  ["closure", "breathy"],
  ["closure", "clean"],
  ["closure", "pressed"],
  ["registers", "falsetto"],
  ["registers", "mix"],
  ["twang", "plain"],
  ["twang", "twang"],
  ["vowels", "ee"],
  ["vowels", "oo"],
  ["grit", "clean"],
  ["grit", "edge"],
  ["grit", "rasp"],
  ["vibrato", "late"],
];

/** One take, sung by an offline voice (as Coach's player sings it live). `maxLength` cuts a long pattern short. */
export function renderTake(v: EngineVoice, vm: VoiceModel, lesson: Lesson, take: Take, note: number, maxLength = Infinity): Float32Array {
  const pat = patternSteps(take.pattern ?? lesson.pattern);
  const length = Math.min(maxLength, pat.length);
  const events: { at: number; run: () => void }[] = [];
  for (const s of pat.steps) if (s.at > 0) events.push({ at: s.at, run: () => v.setSource({ f0: midiHz(note + (s.semis ?? 0)), glide: s.glide ?? 0.04 }) });
  for (const s of take.steps ?? [])
    events.push({
      at: s.at,
      run: () => {
        if (s.shape) v.setArtic(resolveShape(vm, lesson.vowel, mergeShape(take.shape, s.shape)), true);
        if (s.source) v.setSource(s.source);
        if (s.semis !== undefined) v.setSource({ f0: midiHz(note + s.semis), glide: s.glide ?? 0.04 });
      },
    });
  events.sort((a, b) => a.at - b.at);
  v.setArtic(resolveShape(vm, lesson.vowel, take.shape), true);
  v.setSource({ ...BASE_SOURCE, ...take.source, f0: midiHz(note), glide: 0.008 } as Partial<VoiceSource>);
  const parts: Float32Array[] = [v.render(0.09)];
  v.gate(1);
  let t = 0;
  for (const e of events) {
    if (e.at >= length) break;
    if (e.at > t) parts.push(v.render(e.at - t));
    t = Math.max(t, e.at);
    e.run();
  }
  parts.push(v.render(length - t));
  v.gate(0);
  parts.push(v.render(0.5));
  return concat(parts);
}

/** The demo recording for a body, with what was sung when. */
export function renderDemo(module: WebAssembly.Module, body: BodyMix, progress?: (fraction: number) => void): { samples: Float32Array; sampleRate: number; marks: Mark[] } {
  const fs = 48000;
  const vm = new VoiceModel(body, fs);
  const v = new EngineVoice(module, fs, body);
  const parts: Float32Array[] = [v.render(0.3)];
  const marks: Mark[] = [];
  let t = 0.3;
  PROGRAMME.forEach(([lid, tid], i) => {
    const lesson = lessonById(lid);
    const take = lesson.takes.find((x) => x.id === tid) ?? lesson.takes[0];
    const note = HOME[nearestBody(body)] + REGISTER[lesson.register] + (take.semis ?? 0);
    const x = renderTake(v, vm, lesson, take, note, tid === "late" ? 2.6 : 1.5);
    marks.push({ t0: t + 0.09, t1: t + x.length / fs - 0.45, label: `${lesson.title}: ${take.label}` });
    parts.push(x);
    t += x.length / fs;
    progress?.((i + 1) / PROGRAMME.length);
  });
  v.free();
  return { samples: concat(parts), sampleRate: fs, marks };
}
