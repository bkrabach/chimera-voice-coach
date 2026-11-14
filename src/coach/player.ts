/**
 * Coach's state and its demo player: which lesson and take are chosen, and singing a take
 * through the engine (posture, voice source, then the pattern's notes on timers).
 */
import { create } from "zustand";
import { engine } from "../audio/AudioEngine.ts";
import { useStore } from "../ui/store.ts";
import { getModel } from "../ui/useModel.ts";
import { nearestBody } from "../ui/body.ts";
import { DEFAULT_SOURCE, type VoiceSource } from "../wasm/engine.ts";
import { BASE_SOURCE, HOME, LESSONS, lessonById, midiHz, patternSteps, REGISTER } from "./lessons.ts";
import { mergeShape, resolveShape } from "./shape.ts";
import type { Lesson, PartId, Take, ZoneId } from "./types.ts";

export { midiHz };

/**
 * Coach's microphone hangs these on the player while it is on: a take about to sing takes the
 * engine back from it, and between takes (in a loop or a tour) it waits for the singer's go.
 */
export const hooks: { beforeTake?: () => void; afterTake?: () => Promise<boolean> } = {};

interface CoachState {
  lessonId: string;
  takeId: string;
  /** the take sounding now, or null */
  playing: string | null;
  /** a loop is running, though no take sounds at the moment (the singer's go, or the breath between) */
  between: boolean;
  loop: boolean;
  /** playing every take of the lesson in turn */
  tour: boolean;
  /** the user's transposition (semitones) */
  key: number;
  setLesson: (id: string) => void;
  /** choose a take and sing it */
  play: (takeId?: string) => void;
  /** sing every take of the lesson, one after another */
  playAll: () => void;
  stop: () => void;
  setLoop: (on: boolean) => void;
  setKey: (semis: number) => void;
}

const KEY_STORE = "coach.key";
const savedKey = (): number => {
  try {
    const v = Number(localStorage.getItem(KEY_STORE));
    return Number.isFinite(v) ? Math.max(-12, Math.min(12, Math.round(v))) : 0;
  } catch {
    return 0;
  }
};

let timers: ReturnType<typeof setTimeout>[] = [];
/** each play gets a serial; a stale one's timers and awaits do nothing */
let serial = 0;

function clearTimers(): void {
  for (const t of timers) clearTimeout(t);
  timers = [];
}

export const currentLesson = (): Lesson => lessonById(useCoach.getState().lessonId);
export const currentTake = (): Take => {
  const l = currentLesson();
  return l.takes.find((t) => t.id === useCoach.getState().takeId) ?? l.takes[0];
};
export const activeParts = (): PartId[] => currentTake().parts ?? currentLesson().parts;
export const activeZones = (): ZoneId[] => currentTake().zones ?? [];

/** The take's first note (MIDI) for the body shown and the user's key. */
export function takeNote(lesson: Lesson, take: Take): number {
  const st = useStore.getState();
  return HOME[nearestBody(st.body)] + useCoach.getState().key + REGISTER[lesson.register] + (take.semis ?? 0);
}

/** Show a take on the head without singing it: its posture and voice settings. */
export function poseTake(lesson: Lesson, take: Take): void {
  const st = useStore.getState();
  const m = getModel(st.body, st.started ? engine.sampleRate : 48000);
  st.setArtic(resolveShape(m, lesson.vowel, take.shape), true);
  st.setSource({ ...BASE_SOURCE, ...take.source, f0: midiHz(takeNote(lesson, take)) } as Partial<VoiceSource>);
}

/** Sing a take once; resolves when it has finished (or was replaced or stopped). */
async function sing(lesson: Lesson, take: Take, my: number): Promise<void> {
  const st0 = useStore.getState();
  await st0.start();
  if (my !== serial || !useStore.getState().started) return;
  const st = useStore.getState();
  const m = getModel(st.body, engine.sampleRate);
  const note = takeNote(lesson, take);
  hooks.beforeTake?.();
  engine.stopSpeech();
  // the first pitch is set before the breath opens, so the note does not slide in from the last one
  st.setArtic(resolveShape(m, lesson.vowel, take.shape), true);
  st.setSource({ ...BASE_SOURCE, ...take.source, f0: midiHz(note), glide: 0.008 } as Partial<VoiceSource>);
  const { steps, length } = patternSteps(take.pattern ?? lesson.pattern);
  const at = (sec: number, fn: () => void) =>
    timers.push(
      setTimeout(() => {
        if (my === serial) fn();
      }, sec * 1000),
    );
  const lead = 0.09;
  at(lead, () => engine.gate(1));
  for (const s of steps) {
    if (s.at === 0) continue;
    at(lead + s.at, () => useStore.getState().setSource({ f0: midiHz(note + (s.semis ?? 0)), glide: s.glide ?? 0.04 }));
  }
  for (const s of take.steps ?? []) {
    at(lead + s.at, () => {
      const cur = useStore.getState();
      if (s.shape) cur.setArtic(resolveShape(m, lesson.vowel, mergeShape(take.shape, s.shape)), true);
      if (s.source) cur.setSource(s.source);
      if (s.semis !== undefined) cur.setSource({ f0: midiHz(note + s.semis), glide: s.glide ?? 0.04 });
    });
  }
  await new Promise<void>((done) => {
    at(lead + length, () => engine.gate(0));
    // the note's release rings on for a moment
    timers.push(setTimeout(done, (lead + length + 0.45) * 1000));
  });
}

export const useCoach = create<CoachState>((set, get) => ({
  lessonId: LESSONS[0].id,
  takeId: (LESSONS[0].takes.find((t) => t.kind === "aim") ?? LESSONS[0].takes[0]).id,
  playing: null,
  between: false,
  loop: false,
  tour: false,
  key: savedKey(),
  setLesson: (id) => {
    get().stop();
    const l = lessonById(id);
    const take = l.takes.find((t) => t.kind === "aim") ?? l.takes[0];
    set({ lessonId: l.id, takeId: take.id });
    poseTake(l, take);
  },
  play: (takeId) => {
    const l = lessonById(get().lessonId);
    const take = l.takes.find((t) => t.id === (takeId ?? get().takeId)) ?? l.takes[0];
    clearTimers();
    engine.gate(0);
    const my = ++serial;
    set({ takeId: take.id, playing: take.id, tour: false, between: false });
    void (async () => {
      for (;;) {
        set({ playing: take.id, between: false });
        await sing(l, take, my);
        if (my !== serial) return;
        if (!get().loop) break;
        // between the takes: the singer's go if the microphone is on, else a breath
        set({ playing: null, between: true });
        const sang = hooks.afterTake ? await hooks.afterTake() : false;
        if (my !== serial) return;
        await new Promise((r) => timers.push(setTimeout(r, sang ? 700 : 500)));
        if (my !== serial) return;
        if (!get().loop) break;
      }
      set({ playing: null, between: false });
    })();
  },
  playAll: () => {
    const l = lessonById(get().lessonId);
    clearTimers();
    engine.gate(0);
    const my = ++serial;
    set({ tour: true, between: false });
    void (async () => {
      for (const take of l.takes) {
        if (my !== serial) return;
        set({ takeId: take.id, playing: take.id });
        await sing(l, take, my);
        if (my !== serial) return;
        // with the microphone on, each take is answered before the next
        set({ playing: null });
        const sang = hooks.afterTake ? await hooks.afterTake() : false;
        if (my !== serial) return;
        await new Promise((r) => timers.push(setTimeout(r, sang ? 700 : 450)));
      }
      if (my === serial) set({ playing: null, tour: false });
    })();
  },
  stop: () => {
    serial++;
    clearTimers();
    engine.gate(0);
    if (get().playing || get().tour || get().between) set({ playing: null, tour: false, between: false });
  },
  setLoop: (on) => set({ loop: on }),
  setKey: (semis) => {
    const key = Math.max(-12, Math.min(12, Math.round(semis)));
    set({ key });
    try {
      localStorage.setItem(KEY_STORE, String(key));
    } catch {
      /* private mode: the key just is not remembered */
    }
    if (!get().playing) poseTake(currentLesson(), currentTake());
  },
}));

/** Entering Coach: show the chosen take on the head. */
export function enterCoach(): void {
  poseTake(currentLesson(), currentTake());
}

/** Leaving Coach: silence, and the other tabs get their own voice back. */
export function leaveCoach(): void {
  useCoach.getState().stop();
  const st = useStore.getState();
  st.setSource({ ...DEFAULT_SOURCE, f0: st.source.f0 });
  st.setArtic({ velum: -0.15, epilarynx: 0, ventricular: 0 }, true);
}
