/**
 * A stretch of singing in a few numbers, and one stretch beside another: a take as the engine
 * sings it (the target) and the same take as the singer sang it back. Both are read by Analyze's
 * analysis, so they are on the same scales. Plain data and arithmetic: it runs in the worker,
 * on the page and in tests.
 */
import type { VoiceTrack } from "../analyze/analyze.ts";

export interface Summary {
  /** seconds of singing it is drawn from */
  seconds: number;
  /** medians, 0..1 (see src/analyze/interpret.ts) */
  press: number;
  ring: number;
  breath: number;
  grit: number;
  /** the vowel heard most, as a singer spells it ("AH") */
  vowel: string;
  /** the middle pitch, and the lowest and highest notes reached (MIDI numbers, fractional) */
  midi: number;
  low: number;
  high: number;
  /** share of the singing that had vibrato, and its middle rate (per second) and extent (cents each way) */
  vibShare: number;
  vibRate: number;
  vibExtent: number;
}

const median = (v: number[]): number => {
  if (!v.length) return 0;
  const s = v.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
};
const hzToMidi = (f: number) => 69 + 12 * Math.log2(f / 440);

/** Collects sung frames one at a time (they may come from different chunks of a live voice). */
export class Gather {
  private press: number[] = [];
  private ring: number[] = [];
  private breath: number[] = [];
  private grit: number[] = [];
  private midi: number[] = [];
  private note: number[] = [];
  private vibRate: number[] = [];
  private vibExtent: number[] = [];
  private vowels = new Map<string, number>();
  private hop = 0.01;

  /** frames gathered */
  get count(): number {
    return this.press.length;
  }

  reset(): void {
    this.press = [];
    this.ring = [];
    this.breath = [];
    this.grit = [];
    this.midi = [];
    this.note = [];
    this.vibRate = [];
    this.vibExtent = [];
    this.vowels.clear();
  }

  /** Add frame `i` of `t` if it is sung (voiced and matched); says whether it was. */
  push(t: VoiceTrack, i: number): boolean {
    if (!(t.f0[i] > 0) || t.entry[i] < 0) return false;
    this.hop = t.hop;
    this.press.push(t.press[i]);
    this.ring.push(t.ring[i]);
    this.breath.push(t.breath[i]);
    this.grit.push(t.grit[i]);
    this.midi.push(hzToMidi(t.f0[i]));
    this.note.push(hzToMidi(t.note[i] > 0 ? t.note[i] : t.f0[i]));
    if (t.vibExtent[i] > 0) {
      this.vibRate.push(t.vibRate[i]);
      this.vibExtent.push(t.vibExtent[i]);
    }
    const v = t.vowel[i];
    if (v !== 255) this.vowels.set(t.vowelNames[v], (this.vowels.get(t.vowelNames[v]) ?? 0) + 1);
    return true;
  }

  summary(): Summary | null {
    const n = this.count;
    if (!n) return null;
    const notes = this.note.slice().sort((a, b) => a - b);
    let vowel = "", top = 0;
    for (const [k, c] of this.vowels)
      if (c > top) {
        top = c;
        vowel = k;
      }
    return {
      seconds: n * this.hop,
      press: median(this.press),
      ring: median(this.ring),
      breath: median(this.breath),
      grit: median(this.grit),
      vowel,
      midi: median(this.midi),
      low: notes[Math.floor(notes.length * 0.05)],
      high: notes[Math.min(notes.length - 1, Math.floor(notes.length * 0.95))],
      vibShare: this.vibRate.length / n,
      vibRate: median(this.vibRate),
      vibExtent: median(this.vibExtent),
    };
  }
}

/** The sung frames of a track between two frames, in a few numbers; null if nothing was sung. */
export function summarize(t: VoiceTrack, i0 = 0, i1 = t.n): Summary | null {
  const g = new Gather();
  for (let i = Math.max(0, i0); i < Math.min(t.n, i1); i++) g.push(t, i);
  return g.summary();
}

/** How far a pitch is from another, in cents, ignoring whole octaves (a singer may take it an octave down). */
export function centsOff(midi: number, target: number): number {
  const c = 100 * (midi - target);
  return ((((c + 600) % 1200) + 1200) % 1200) - 600;
}

export const MEASURES = ["press", "ring", "breath", "grit"] as const;
export type Measure = (typeof MEASURES)[number];

/** how far apart two readings must be before it is worth saying (the scales are rough on a real voice) */
const GAP = 0.18;

const ADVICE: Record<Measure, { less: string; more: string }> = {
  press: {
    less: "Your folds are closing more lightly than the take's. Start the note as cleanly as the catch in 'uh-oh', and keep them together.",
    more: "You are pressing harder than the take. Same note, less squeeze: let it be easier.",
  },
  ring: {
    less: "Less ring than the take. Narrow the funnel just above the folds: find the bratty 'nyeah' edge and keep it.",
    more: "More ring than the take. Let the throat widen, toward the start of a yawn.",
  },
  breath: {
    less: "Less air than the take. Let a little breath through with the note.",
    more: "Airier than the take. Bring the folds together until the hiss goes.",
  },
  grit: {
    less: "Cleaner than the take, which has a rattle on top of the note.",
    more: "More rattle than the take. Take it off and find the clean note underneath first.",
  },
};

/**
 * What to change to get closer to the take, most telling first (at most two things), or that it
 * is close. `steady`: the take holds one note, so the pitch can be compared too.
 */
export function advise(target: Summary, you: Summary, steady: boolean): string[] {
  const out: string[] = [];
  const gaps = MEASURES.map((m) => ({ m, d: you[m] - target[m] }))
    .filter((g) => Math.abs(g.d) >= GAP)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  for (const g of gaps.slice(0, 2)) out.push(g.d < 0 ? ADVICE[g.m].less : ADVICE[g.m].more);
  if (steady) {
    const c = Math.round(centsOff(you.midi, target.midi));
    if (Math.abs(c) > 30) out.push(`About ${Math.abs(c)} cents ${c < 0 ? "flat" : "sharp"} of the take's note.`);
  }
  if (!out.length) out.push("Close to the take: closure, ring, air and grit are all within reach of it.");
  return out.slice(0, 3);
}
