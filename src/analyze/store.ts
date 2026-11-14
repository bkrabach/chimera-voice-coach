/**
 * Analyze's state: the recording that was opened, its analysis, and its playback. While the
 * recording plays, the engine is driven from the analysis frame under the playhead, so the head,
 * the folds and the spectrum show what was measured, and the engine's own voice (the "model")
 * can be faded in against the original.
 */
import { create } from "zustand";
import { engine } from "../audio/AudioEngine.ts";
import { useStore } from "../ui/store.ts";
import { sameBody, type BodyMix } from "../ui/body.ts";
import { DEFAULT_SOURCE, type HumanArtic, type VoiceSource } from "../wasm/engine.ts";
import { KIND, type VoiceTrack } from "./analyze.ts";
import type { Mark } from "./demo.ts";
import { askWorker, nextId } from "./client.ts";

export type Status = "empty" | "working" | "ready" | "error";

interface AnalyzeState {
  status: Status;
  stage: string;
  progress: number;
  error: string | null;
  /** the file's name, or "Demo" */
  name: string | null;
  track: VoiceTrack | null;
  /** the vowel each matched shape is nearest to (indexed by VoiceTrack.shape) */
  vowelOf: string[];
  /** what was sung when, where that is known (the demo) */
  marks: Mark[];
  playing: boolean;
  rate: number;
  /** 0 the recording alone … 1 the model voice alone */
  mix: number;
  loop: [number, number] | null;
  /** which sound plays: the isolated vocal, or the full track it came from */
  heard: "vocal" | "full";
  hasFull: boolean;
  /** can full tracks be split here (the local helper is running)? null until asked */
  canIsolate: boolean | null;
  open: (file: File, isolate: boolean) => Promise<void>;
  demo: () => Promise<void>;
  toggle: () => void;
  seek: (t: number) => void;
  setRate: (r: number) => void;
  setMix: (m: number) => void;
  setLoop: (l: [number, number] | null) => void;
  setHeard: (h: "vocal" | "full") => void;
  checkIsolate: () => Promise<void>;
}

// ------------------------------------------------------------------ outside React

/** the newest request: an older one's result is dropped */
let request = 0;
/** the vocal, mono at the context's rate: kept so another body can be matched without reopening */
let samples: { x: Float32Array; fs: number } | null = null;
let trackBody: BodyMix | null = null;
/** the level the recording's louder singing reaches (dB) */
let loud = -20;

interface Player {
  el: HTMLAudioElement;
  node: MediaElementAudioSourceNode;
  url: string;
}
const players: { vocal: Player | null; full: Player | null } = { vocal: null, full: null };
let recGain: GainNode | null = null;
let raf = 0;
let entered = false;

function current(): Player | null {
  const s = useAnalyze.getState();
  return (s.heard === "full" ? players.full : null) ?? players.vocal;
}

/** The playhead (s). */
export function position(): number {
  return current()?.el.currentTime ?? 0;
}

function disposePlayers(): void {
  for (const k of ["vocal", "full"] as const) {
    const p = players[k];
    if (!p) continue;
    p.el.pause();
    p.node.disconnect();
    URL.revokeObjectURL(p.url);
    players[k] = null;
  }
}

function makePlayer(blob: Blob): Player {
  const ctx = engine.ctx!;
  if (!recGain) {
    recGain = ctx.createGain();
    recGain.connect(engine.mixIn!);
  }
  const url = URL.createObjectURL(blob);
  const el = new Audio();
  el.preload = "auto";
  el.src = url;
  // slowed down, the pitch stays where it was sung
  (el as HTMLAudioElement & { preservesPitch: boolean }).preservesPitch = true;
  const node = ctx.createMediaElementSource(el);
  node.connect(recGain);
  return { el, node, url };
}

function applyMix(): void {
  const m = useAnalyze.getState().mix;
  if (recGain && engine.ctx) recGain.gain.setTargetAtTime(Math.cos((m * Math.PI) / 2), engine.ctx.currentTime, 0.02);
  engine.setVoiceLevel(entered ? Math.sin((m * Math.PI) / 2) : 1);
}

/** 16-bit mono WAV of a float signal. */
export function encodeWav(x: Float32Array, fs: number): Blob {
  const buf = new ArrayBuffer(44 + x.length * 2);
  const dv = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  dv.setUint32(4, 36 + x.length * 2, true);
  str(8, "WAVEfmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, fs, true);
  dv.setUint32(28, fs * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  str(36, "data");
  dv.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) dv.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), true);
  return new Blob([buf], { type: "audio/wav" });
}

/** progress of the newest request, onto the screen */
const stageOf = (id: number) => (stage: string, fraction: number) => {
  if (id === request) useAnalyze.setState({ stage, progress: fraction });
};

function setTrack(track: VoiceTrack, vowelOf: string[], body: BodyMix): void {
  trackBody = body;
  const lv: number[] = [];
  for (let i = 0; i < track.n; i++) if (track.kind[i] === KIND.voiced) lv.push(track.level[i]);
  lv.sort((a, b) => a - b);
  loud = lv.length ? lv[Math.floor(lv.length * 0.95)] : -20;
  useAnalyze.setState({ track, vowelOf, status: "ready", stage: "", progress: 1, error: null });
}

const fail = (e: unknown) => useAnalyze.setState({ status: "error", error: e instanceof Error ? e.message : String(e), playing: false });

// ------------------------------------------------------------------ driving the engine

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** piecewise-linear lookup */
function table(x: number, pts: [number, number][]): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) return pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * (x - pts[i - 1][0])) / (pts[i][0] - pts[i - 1][0]);
  return pts[pts.length - 1][1];
}

/**
 * The engine's source settings that give back a frame's measurements: the inverse of what
 * tools/analyze-calibrate.ts measured (a source slope of −12.9 dB/oct came from tension 0.05, −2 from 0.95, …).
 */
export function sourceAt(t: VoiceTrack, i: number, loudDb: number = loud): Partial<VoiceSource> {
  const tension = table(t.slope[i], [[-13, 0.05], [-11.6, 0.22], [-9.6, 0.5], [-6.5, 0.72], [-4, 0.85], [-2, 0.95]]);
  const grit = t.grit[i];
  return {
    f0: t.f0[i],
    glide: 0.012,
    vibratoDepth: 0,
    drift: 0,
    fry: 0,
    roughness: 0.1,
    voiced: true,
    tension,
    brightness: 0.1 + 0.5 * t.press[i],
    breathiness: 0.05 + 0.75 * t.breath[i],
    distortion: grit > 0.12 ? 0.2 + 0.55 * grit : 0,
    pressure: 5 + 8 * clamp01((t.level[i] - (loudDb - 28)) / 28) + 3 * t.press[i],
  };
}

/** The posture of a frame, with the ring it measured narrowing the twang funnel and its grit drawing the false folds in. */
export function articAt(t: VoiceTrack, i: number): Partial<HumanArtic> {
  const a: Record<string, number> = {};
  const nK = t.keys.length;
  for (let k = 0; k < nK; k++) a[t.keys[k]] = t.artic[i * nK + k];
  a.epilarynx = 0.12 + 0.78 * t.ring[i];
  a.ventricular = 0.9 * t.grit[i];
  a.velum = -0.15;
  return a as Partial<HumanArtic>;
}

/** the frame index at a time, inside the track */
export const frameAt = (t: VoiceTrack, sec: number) => Math.max(0, Math.min(t.n - 1, Math.round(sec / t.hop)));

/** the articulators take a few tens of ms to arrive: they are sent where the recording is about to be */
const LOOK = 0.035;

function drive(): void {
  raf = requestAnimationFrame(drive);
  const s = useAnalyze.getState();
  const t = s.track;
  const p = current();
  if (!t || !p || !useStore.getState().started) return;
  let now = p.el.currentTime;
  if (s.playing) {
    if (s.loop && (now >= s.loop[1] || now < s.loop[0] - 0.05)) {
      p.el.currentTime = s.loop[0];
      now = s.loop[0];
    }
    if (p.el.ended) {
      useAnalyze.setState({ playing: false });
      engine.gate(0);
      return;
    }
  }
  const i = frameAt(t, now + LOOK);
  if (t.artic.length) engine.setArtic(articAt(t, i), true);
  const j = frameAt(t, now + 0.01);
  if (t.f0[j] > 0 && t.entry[j] >= 0) {
    engine.setSource(sourceAt(t, j));
    engine.gate(s.playing ? 1 : 0);
  } else engine.gate(0);
}

/** Entering Analyze: the engine follows the playhead. */
export function enterAnalyze(): void {
  if (entered) return;
  entered = true;
  applyMix();
  raf = requestAnimationFrame(drive);
  void useAnalyze.getState().checkIsolate();
}

/** Leaving Analyze: silence, and the other tabs get their voice back. */
export function leaveAnalyze(): void {
  if (!entered) return;
  entered = false;
  cancelAnimationFrame(raf);
  current()?.el.pause();
  useAnalyze.setState({ playing: false });
  engine.gate(0);
  engine.setVoiceLevel(1);
  const st = useStore.getState();
  st.setSource({ ...DEFAULT_SOURCE, f0: st.source.f0 });
  st.setArtic({ velum: -0.15, epilarynx: 0, ventricular: 0 }, true);
}

/** The body changed: the same recording is matched against the new body's shapes. */
export async function rematch(): Promise<void> {
  const body = useStore.getState().body;
  if (!samples || !trackBody || sameBody(body, trackBody) || useAnalyze.getState().status === "working") return;
  const id = (request = nextId());
  useAnalyze.setState({ status: "working", stage: "Matching the new body", progress: 0, playing: false });
  current()?.el.pause();
  try {
    const r = await askWorker({ type: "analyze", id, samples: samples.x.slice(), sampleRate: samples.fs, body }, [], stageOf(id));
    if (id === request) setTrack(r.track, r.vowelOf, body);
  } catch (e) {
    if (id === request) fail(e);
  }
}

// ------------------------------------------------------------------ the store

export const useAnalyze = create<AnalyzeState>((set, get) => ({
  status: "empty",
  stage: "",
  progress: 0,
  error: null,
  name: null,
  track: null,
  vowelOf: [],
  marks: [],
  playing: false,
  rate: 1,
  mix: 0,
  loop: null,
  heard: "vocal",
  hasFull: false,
  canIsolate: null,
  checkIsolate: async () => {
    try {
      const r = await fetch("/api/separate");
      const j = r.ok ? ((await r.json()) as { available?: boolean }) : {};
      set({ canIsolate: !!j.available });
    } catch {
      set({ canIsolate: false });
    }
  },
  open: async (file, isolate) => {
    const id = (request = nextId());
    current()?.el.pause();
    set({ status: "working", stage: "Reading the file", progress: 0, error: null, name: file.name, playing: false, loop: null, marks: [], track: null });
    try {
      await useStore.getState().start();
      if (!useStore.getState().started || !engine.ctx) throw new Error(useStore.getState().startError ?? "the audio could not start");
      let vocal: Blob = file;
      if (isolate) {
        set({ stage: "Isolating the vocal from the track (a minute or two)", progress: 0 });
        const res = await fetch("/api/separate", { method: "POST", headers: { "content-type": "application/octet-stream", "x-filename": encodeURIComponent(file.name) }, body: file });
        if (!res.ok) {
          let msg = `the vocal could not be isolated (HTTP ${res.status})`;
          try {
            msg = ((await res.json()) as { error?: string }).error ?? msg;
          } catch {
            /* not JSON: keep the status */
          }
          throw new Error(msg);
        }
        vocal = await res.blob();
      }
      if (id !== request) return;
      set({ stage: "Decoding", progress: 0 });
      const audio = await engine.ctx.decodeAudioData(await vocal.arrayBuffer());
      const x = new Float32Array(audio.length);
      for (let c = 0; c < audio.numberOfChannels; c++) {
        const ch = audio.getChannelData(c);
        for (let i = 0; i < x.length; i++) x[i] += ch[i] / audio.numberOfChannels;
      }
      if (id !== request) return;
      samples = { x, fs: audio.sampleRate };
      disposePlayers();
      players.vocal = makePlayer(vocal);
      players.full = isolate ? makePlayer(file) : null;
      set({ hasFull: isolate, heard: "vocal" });
      applyMix();
      const body = useStore.getState().body;
      const r = await askWorker({ type: "analyze", id, samples: x.slice(), sampleRate: audio.sampleRate, body }, [], stageOf(id));
      if (id === request) setTrack(r.track, r.vowelOf, body);
    } catch (e) {
      if (id === request) fail(e);
    }
  },
  demo: async () => {
    const id = (request = nextId());
    current()?.el.pause();
    set({ status: "working", stage: "Singing the demo", progress: 0, error: null, name: "Demo: the synthesizer sings Coach's takes", playing: false, loop: null, marks: [], track: null });
    try {
      await useStore.getState().start();
      if (!useStore.getState().started || !engine.ctx) throw new Error(useStore.getState().startError ?? "the audio could not start");
      const body = useStore.getState().body;
      const r = await askWorker({ type: "demo", id, body }, [], stageOf(id));
      if (id !== request || !r.demo) return;
      samples = { x: r.demo.samples, fs: r.demo.sampleRate };
      disposePlayers();
      players.vocal = makePlayer(encodeWav(r.demo.samples, r.demo.sampleRate));
      set({ hasFull: false, heard: "vocal", marks: r.demo.marks });
      applyMix();
      setTrack(r.track, r.vowelOf, body);
    } catch (e) {
      if (id === request) fail(e);
    }
  },
  toggle: () => {
    const p = current();
    if (!p || get().status !== "ready") return;
    if (get().playing) {
      p.el.pause();
      engine.gate(0);
      set({ playing: false });
      return;
    }
    const s = get();
    if (p.el.ended || p.el.currentTime >= p.el.duration - 0.05) p.el.currentTime = s.loop ? s.loop[0] : 0;
    p.el.playbackRate = s.rate;
    void engine.ctx?.resume();
    void p.el.play().then(
      () => set({ playing: true }),
      (e) => fail(e),
    );
  },
  seek: (t) => {
    const p = current();
    if (!p) return;
    p.el.currentTime = Math.max(0, Math.min(Number.isFinite(p.el.duration) ? p.el.duration : t, t));
  },
  setRate: (r) => {
    set({ rate: r });
    const p = current();
    if (p) p.el.playbackRate = r;
  },
  setMix: (m) => {
    set({ mix: clamp01(m) });
    applyMix();
  },
  setLoop: (l) => set({ loop: l && l[1] - l[0] > 0.15 ? l : null }),
  setHeard: (h) => {
    const was = current();
    const at = was?.el.currentTime ?? 0;
    const playing = get().playing;
    was?.el.pause();
    set({ heard: h });
    const p = current();
    if (!p) return;
    p.el.currentTime = at;
    p.el.playbackRate = get().rate;
    if (playing) void p.el.play();
  },
}));
