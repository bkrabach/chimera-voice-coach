/**
 * Coach's microphone: the singer's own voice, read by the same analysis as a recording, a moment
 * at a time. While a take sings, the microphone waits (it would only hear the speakers). When it
 * stops, what the singer sings back is read live: the head, the folds and the spectrum show the
 * singer, and each phrase is summed up beside the take it answers.
 *
 * Nothing is recorded or sent anywhere: the last few seconds live in memory for the analysis.
 */
import { create } from "zustand";
import tapUrl from "../worklet/tap.ts?worker&url";
import { engine } from "../audio/AudioEngine.ts";
import { useStore } from "../ui/store.ts";
import { bodyKey, type BodyMix } from "../ui/body.ts";
import { askWorker } from "../analyze/client.ts";
import { articAt, sourceAt } from "../analyze/store.ts";
import type { VoiceTrack } from "../analyze/analyze.ts";
import { Gather, type Summary } from "./compare.ts";
import { currentLesson, currentTake, hooks, poseTake, takeNote, useCoach } from "./player.ts";

export type MicStatus = "off" | "asking" | "preparing" | "on" | "error";

/** The singer's voice right now. */
export interface Live {
  voiced: boolean;
  hz: number;
  /** the pitch as a MIDI number (fractional) */
  midi: number;
  vowel: string;
  press: number;
  ring: number;
  breath: number;
  grit: number;
  vibRate: number;
  vibExtent: number;
}

interface MicState {
  status: MicStatus;
  error: string | null;
  /** a phrase is being sung */
  hearing: boolean;
  live: Live | null;
  /** the current lesson's takes as the engine sings them, by take id (empty until measured) */
  targets: Record<string, Summary>;
  /** the singer's last go at each take, by `lesson/take` */
  attempts: Record<string, Summary>;
  toggle: () => Promise<void>;
  off: () => void;
}

const FS = 48000;
/** 10 ms: the analysis's frame, in microphone samples */
const FRAME = 480;
/** how much of the voice each analysis looks at, and how much is kept */
const CHUNK = Math.round(1.6 * FS);
const RING = 8 * FS;
/** frames at the end of a chunk whose windows are not yet full: they are read on the next pass */
const LOOKBACK = 10;
/** the level a singer at a microphone is taken to reach (dB re full scale), for the head's breath */
const LOUD = -14;

let stream: MediaStream | null = null;
let nodes: { src: MediaStreamAudioSourceNode; tap: AudioWorkletNode; listen: GainNode; sink: GainNode } | null = null;
let moduleLoaded = false;
const ring = new Float32Array(RING);
/** samples written since the microphone opened */
let written = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let busy = false;
/** the last frame read (counted from the microphone opening) */
let lastFinal = -1;
/** whose turn: the take's (the microphone waits) or the singer's */
let turn: "take" | "you" = "you";
/** when the singer's turn began (in samples), and until when the room is left to fall quiet (ms) */
let youSince = 0;
let quietUntil = 0;
const gather = new Gather();
let silent = 0;
/** sung frames since the tract was last sized */
let sinceSize = 0;
let waiter: { resolve: (sang: boolean) => void; startBy: number; endBy: number } | null = null;
let unsubscribe: (() => void)[] = [];
const targetCache = new Map<string, Record<string, Summary>>();
let targetKey = "";

// ------------------------------------------------------------------ the singer's tract size

const ALPHA_STORE = "coach.mic.alpha";
function loadAlpha(body: BodyMix): number | undefined {
  try {
    const v = (JSON.parse(localStorage.getItem(ALPHA_STORE) ?? "{}") as Record<string, number>)[bodyKey(body)];
    return typeof v === "number" && v > 0.7 && v < 1.4 ? v : undefined;
  } catch {
    return undefined;
  }
}
function saveAlpha(body: BodyMix, a: number): void {
  try {
    const all = JSON.parse(localStorage.getItem(ALPHA_STORE) ?? "{}") as Record<string, number>;
    all[bodyKey(body)] = a;
    localStorage.setItem(ALPHA_STORE, JSON.stringify(all));
  } catch {
    /* private mode: it is sized again next time */
  }
}

// ------------------------------------------------------------------ samples

function copy(start: number, end: number): Float32Array {
  const out = new Float32Array(end - start);
  for (let i = 0; i < out.length; i++) out[i] = ring[(start + i) % RING];
  return out;
}

function setTurn(t: "take" | "you"): void {
  turn = t;
  if (!nodes || !engine.ctx) return;
  const now = engine.ctx.currentTime;
  // the singer's turn: the engine follows the microphone in silence, and the spectrum shows the microphone
  engine.setVoiceLevel(t === "take" ? 1 : 0);
  nodes.listen.gain.setTargetAtTime(t === "take" ? 0 : 1, now, 0.02);
  if (t === "you") {
    youSince = written;
    lastFinal = Math.floor(written / FRAME) - 1;
  }
}

/** A phrase has ended (or is abandoned): keep it if it was long enough to say anything. */
function endPhrase(keep: boolean): void {
  const s = keep && gather.count >= 50 ? gather.summary() : null;
  gather.reset();
  silent = 0;
  if (useMic.getState().hearing) useMic.setState({ hearing: false });
  if (!s) return;
  const key = `${currentLesson().id}/${currentTake().id}`;
  useMic.setState((st) => ({ attempts: { ...st.attempts, [key]: s } }));
  if (waiter) {
    waiter.resolve(true);
    waiter = null;
  }
}

function frame(t: VoiceTrack, i: number): void {
  if (gather.push(t, i)) {
    silent = 0;
    sinceSize++;
    if (!useMic.getState().hearing) useMic.setState({ hearing: true });
  } else if (gather.count > 0 && ++silent > 60) endPhrase(true);
}

/** Read the frames of a chunk that are new, and show the newest on the head. */
function consume(t: VoiceTrack, base: number): void {
  const final = base + t.n - 1 - LOOKBACK;
  for (let abs = Math.max(lastFinal + 1, base); abs <= final; abs++) frame(t, abs - base);
  if (final > lastFinal) lastFinal = final;
  const i = final - base;
  if (i < 0 || i >= t.n) return;
  const voiced = t.f0[i] > 0 && t.entry[i] >= 0;
  if (voiced) {
    engine.setArtic(articAt(t, i), true);
    engine.setSource(sourceAt(t, i, LOUD));
    engine.gate(1);
    useMic.setState({
      live: {
        voiced: true,
        hz: t.f0[i],
        midi: 69 + 12 * Math.log2((t.note[i] > 0 ? t.note[i] : t.f0[i]) / 440),
        vowel: t.vowel[i] === 255 ? "" : t.vowelNames[t.vowel[i]],
        press: t.press[i],
        ring: t.ring[i],
        breath: t.breath[i],
        grit: t.grit[i],
        vibRate: t.vibRate[i],
        vibExtent: t.vibExtent[i],
      },
    });
  } else {
    engine.gate(0);
    const live = useMic.getState().live;
    if (live?.voiced) useMic.setState({ live: { ...live, voiced: false } });
  }
}

/** Size the singer's tract from the last few seconds of their own singing (not the take's). */
async function size(body: BodyMix): Promise<void> {
  const end = written - (written % FRAME);
  const start = Math.max(end - 6 * FS, youSince - (youSince % FRAME), written - RING + FRAME);
  if (end - start < 2.5 * FS) return;
  sinceSize = 0;
  const x = copy(start, end);
  const r = await askWorker({ type: "analyze", samples: x, sampleRate: FS, body }, [x.buffer]);
  let sung = 0;
  for (let i = 0; i < r.track.n; i++) if (r.track.f0[i] > 0) sung++;
  if (sung < 150) return;
  const was = loadAlpha(body);
  saveAlpha(body, was === undefined ? r.track.alpha : 0.6 * was + 0.4 * r.track.alpha);
}

async function tick(): Promise<void> {
  const st = useMic.getState();
  if ((st.status !== "on" && st.status !== "preparing") || busy) return;
  const now = performance.now();
  if (useCoach.getState().playing !== null) {
    if (turn !== "take") {
      endPhrase(false);
      setTurn("take");
    }
    return;
  }
  if (turn === "take") {
    // the take has stopped: let the room fall quiet before listening
    if (!quietUntil) quietUntil = now + 350;
    if (now < quietUntil) return;
    quietUntil = 0;
    setTurn("you");
  }
  if (waiter && ((gather.count === 0 && now > waiter.startBy) || now > waiter.endBy)) {
    waiter.resolve(false);
    waiter = null;
  }
  const end = written - (written % FRAME);
  const start = Math.max(end - CHUNK, 0, written - RING + FRAME - ((written - RING + FRAME) % FRAME));
  if (end - start < 0.5 * FS) return;
  busy = true;
  try {
    const body = useStore.getState().body;
    const x = copy(start, end);
    const r = await askWorker({ type: "live", samples: x, sampleRate: FS, body, alpha: loadAlpha(body) }, [x.buffer]);
    const s = useMic.getState().status;
    if (s === "off" || s === "error") return;
    if (s === "preparing") useMic.setState({ status: "on" });
    // a take that began meanwhile: this chunk heard the speakers
    if (useCoach.getState().playing === null && turn === "you") consume(r.track, start / FRAME);
    if (sinceSize >= 250 && turn === "you") await size(body);
  } catch (e) {
    fail(e);
  } finally {
    busy = false;
  }
}

function fail(e: unknown): void {
  shut();
  useMic.setState({ status: "error", error: e instanceof Error ? e.message : String(e), live: null, hearing: false });
}

/** Measure the current lesson's takes as the engine sings them (once per lesson, body and key). */
async function refreshTargets(): Promise<void> {
  if (useMic.getState().status === "off") return;
  const lesson = currentLesson();
  const body = useStore.getState().body;
  const key = `${lesson.id}|${bodyKey(body)}|${useCoach.getState().key}`;
  if (key === targetKey) return;
  targetKey = key;
  const known = targetCache.get(key);
  useMic.setState({ targets: known ?? {} });
  if (known) return;
  const notes: Record<string, number> = {};
  for (const t of lesson.takes) notes[t.id] = takeNote(lesson, t);
  try {
    const r = await askWorker<"targets">({ type: "targets", body, lesson, notes });
    targetCache.set(key, r.targets);
    if (targetKey === key) useMic.setState({ targets: r.targets });
  } catch (e) {
    console.warn("coach targets:", e);
    if (targetKey === key) targetKey = "";
  }
}

/** Close the microphone and give the engine back to the takes. */
function shut(): void {
  if (timer) clearInterval(timer);
  timer = null;
  for (const u of unsubscribe) u();
  unsubscribe = [];
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  if (nodes) {
    nodes.tap.port.onmessage = null;
    nodes.src.disconnect();
    nodes.tap.disconnect();
    nodes.listen.disconnect();
    nodes.sink.disconnect();
    nodes = null;
  }
  if (waiter) {
    waiter.resolve(false);
    waiter = null;
  }
  gather.reset();
  hooks.beforeTake = undefined;
  hooks.afterTake = undefined;
  targetKey = "";
  if (useStore.getState().started) {
    engine.gate(0);
    engine.setVoiceLevel(1);
    if (useCoach.getState().playing === null) poseTake(currentLesson(), currentTake());
  }
}

export const useMic = create<MicState>((set, get) => ({
  status: "off",
  error: null,
  hearing: false,
  live: null,
  targets: {},
  attempts: {},
  off: () => {
    if (get().status === "off") return;
    shut();
    set({ status: "off", live: null, hearing: false });
  },
  toggle: async () => {
    const s = get().status;
    if (s === "on" || s === "preparing" || s === "asking") return get().off();
    set({ status: "asking", error: null });
    try {
      await useStore.getState().start();
      const ctx = engine.ctx;
      if (!useStore.getState().started || !ctx || !engine.listenIn) throw new Error(useStore.getState().startError ?? "the audio could not start");
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("this browser gives pages no microphone (it needs https or localhost)");
      // the voice as it is: the browser's call-quality processing would flatten what is being measured
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
      if (get().status !== "asking") {
        // switched off while the browser was asking
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
        return;
      }
      if (!moduleLoaded) {
        await ctx.audioWorklet.addModule(tapUrl);
        moduleLoaded = true;
      }
      const src = ctx.createMediaStreamSource(stream);
      const tap = new AudioWorkletNode(ctx, "mic-tap", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const listen = ctx.createGain();
      const sink = ctx.createGain();
      sink.gain.value = 0;
      src.connect(tap);
      // the tap makes no sound, but a node must lead to the output to be run
      tap.connect(sink).connect(ctx.destination);
      src.connect(listen).connect(engine.listenIn);
      nodes = { src, tap, listen, sink };
      written = 0;
      lastFinal = -1;
      sinceSize = 0;
      quietUntil = 0;
      tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
        const c = e.data;
        for (let i = 0; i < c.length; i++) ring[(written + i) % RING] = c[i];
        written += c.length;
      };
      // a take starting takes the engine back at once (its first note must not be muted)
      hooks.beforeTake = () => {
        endPhrase(false);
        setTurn("take");
      };
      // in a loop or a tour the singer's go comes between the takes: wait for it (or for silence)
      hooks.afterTake = () =>
        new Promise<boolean>((resolve) => {
          waiter?.resolve(false);
          const now = performance.now();
          waiter = { resolve, startBy: now + 3800, endBy: now + 14000 };
        });
      setTurn(useCoach.getState().playing !== null ? "take" : "you");
      set({ status: "preparing" });
      timer = setInterval(() => void tick(), 100);
      unsubscribe = [
        useCoach.subscribe((a, b) => {
          if (a.lessonId !== b.lessonId || a.key !== b.key) void refreshTargets();
        }),
        useStore.subscribe((a, b) => {
          if (a.body !== b.body) void refreshTargets();
        }),
      ];
      void refreshTargets();
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
      const none = e instanceof DOMException && e.name === "NotFoundError";
      shut();
      set({ status: "error", error: denied ? "the browser was not allowed to use the microphone" : none ? "no microphone was found" : e instanceof Error ? e.message : String(e) });
    }
  },
}));
