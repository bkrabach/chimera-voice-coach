import { useEffect } from "react";
import { useStore } from "../store.ts";
import { enterCoach, leaveCoach, takeNote, useCoach, midiHz } from "../../coach/player.ts";
import { useMic } from "../../coach/mic.ts";
import { advise, centsOff, MEASURES, type Measure, type Summary } from "../../coach/compare.ts";
import { LESSONS, lessonById } from "../../coach/lessons.ts";
import type { Lesson, Take } from "../../coach/types.ts";
import { ActionBar, PrimaryButton } from "./ActionBar.tsx";
import { Chip, Screen } from "./Screen.tsx";
import { Stroboscope } from "./Stroboscope.tsx";
import { SpectrumView } from "./SpectrumView.tsx";
import { noteName } from "./VoiceControls.tsx";

export { coachInfo, coachOverlay, coachSlots } from "../../coach/callouts.ts";

const GROUPS: Lesson["group"][] = ["Foundation", "Tone", "Rock tools"];
const KIND_LABEL: Record<Take["kind"], string> = { aim: "Aim for", avoid: "Avoid", compare: "Compare" };

/** Coach's main button: sing the chosen take (or stop), and how it is sung. */
function CoachActions() {
  const playing = useCoach((s) => s.playing);
  const tour = useCoach((s) => s.tour);
  const between = useCoach((s) => s.between);
  const loop = useCoach((s) => s.loop);
  const key = useCoach((s) => s.key);
  const mic = useMic((s) => s.status);
  const toggleMic = useMic((s) => s.toggle);
  const lessonId = useCoach((s) => s.lessonId);
  const takeId = useCoach((s) => s.takeId);
  const { play, playAll, stop, setLoop, setKey } = useCoach.getState();
  // the note depends on the body shown
  useStore((s) => s.body);
  const lesson = lessonById(lessonId);
  const take = lesson.takes.find((t) => t.id === takeId) ?? lesson.takes[0];
  const note = noteName(midiHz(takeNote(lesson, take)));
  // a loop or a tour waiting between takes is still running: the button stops it
  const running = !!playing || between || tour;
  const toggle = () => (running ? stop() : play());
  const micOn = mic === "on" || mic === "preparing" || mic === "asking";
  return (
    <ActionBar label="Demonstrate" onSpace={toggle}>
      <PrimaryButton label="Sing it" playing={running} onClick={toggle} title="Sing the chosen take (Space)" />
      <Chip toggle={false} on={tour} onClick={() => (tour ? stop() : playAll())} title="Sing every take of this lesson, one after another, to hear the differences">
        Compare all
      </Chip>
      <Chip on={loop} onClick={() => setLoop(!loop)} title="Repeat the take, with a breath between, so you can sing along">
        Loop
      </Chip>
      <Chip on={micOn} onClick={() => void toggleMic()} title="Your microphone: after a take, sing it back and see your own voice on the head and beside the take. With Loop on, the take and you alternate. Nothing is recorded or sent anywhere.">
        {mic === "asking" || mic === "preparing" ? "Mic…" : "Mic"}
      </Chip>
      <span className="coach-key" role="group" aria-label="Key">
        <Chip toggle={false} onClick={() => setKey(key - 1)} disabled={key <= -12} aria-label="Lower the key a semitone">
          −
        </Chip>
        <span className="coach-key-note" title="The take's starting note. Move it to where your own voice sits.">
          <b>{note}</b>
          <i>{key === 0 ? "Key" : `Key ${key > 0 ? "+" : ""}${key}`}</i>
        </span>
        <Chip toggle={false} onClick={() => setKey(key + 1)} disabled={key >= 12} aria-label="Raise the key a semitone">
          +
        </Chip>
      </span>
    </ActionBar>
  );
}

function LessonList() {
  const lessonId = useCoach((s) => s.lessonId);
  const setLesson = useCoach((s) => s.setLesson);
  return (
    <nav className="coach-lessons" aria-label="Lessons">
      {GROUPS.map((g) => (
        <div key={g} className="coach-group">
          <h3>{g}</h3>
          {LESSONS.filter((l) => l.group === g).map((l) => (
            <button key={l.id} type="button" className={`coach-lesson${l.id === lessonId ? " on" : ""}`} aria-current={l.id === lessonId ? "true" : undefined} onClick={() => setLesson(l.id)}>
              {l.title}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

function Takes(props: { lesson: Lesson }) {
  const takeId = useCoach((s) => s.takeId);
  const playing = useCoach((s) => s.playing);
  const play = useCoach((s) => s.play);
  const take = props.lesson.takes.find((t) => t.id === takeId) ?? props.lesson.takes[0];
  return (
    <div className="coach-takes">
      <div className="coach-take-row" role="group" aria-label="Takes: the same notes sung different ways">
        {props.lesson.takes.map((t) => (
          <button key={t.id} type="button" className={`coach-take ${t.kind}${t.id === takeId ? " on" : ""}${t.id === playing ? " sounding" : ""}`} aria-pressed={t.id === takeId} onClick={() => play(t.id)} title="Sing this take">
            <span className="coach-take-kind">{KIND_LABEL[t.kind]}</span>
            <span className="coach-take-name">{t.label}</span>
          </button>
        ))}
      </div>
      <p className={`coach-says ${take.kind}`}>{take.says}</p>
    </div>
  );
}

const MEASURE_NAME: Record<Measure, string> = { press: "Drive", ring: "Ring", breath: "Air", grit: "Grit" };
const MEASURE_COLOR: Record<Measure, string> = { press: "var(--white)", ring: "var(--pink)", breath: "var(--blue)", grit: "var(--red)" };
const pc = (v: number | undefined) => (v === undefined ? "–" : String(Math.round(v * 100)));

/** a take holds one note (so the singer's pitch can be set against it) */
const holdsOneNote = (l: Lesson, t: Take) => (t.pattern ?? l.pattern) === "hold" && !(t.steps ?? []).some((s) => s.semis !== undefined);

/** One scale: where the take sits (the tick), where the singer is now (the dot), and their last go (the ring). */
function YouMeter(props: { m: Measure; target?: Summary; last?: Summary; live: number | null }) {
  const { m, target, last, live } = props;
  const at = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
  return (
    <div className="you-meter">
      <span className="you-name" style={{ color: MEASURE_COLOR[m] }}>
        {MEASURE_NAME[m]}
      </span>
      <span className="you-bar">
        {target && <i className="you-target" style={{ left: at(target[m]) }} title="The take" />}
        {last && <i className="you-last" style={{ left: at(last[m]), borderColor: MEASURE_COLOR[m] }} title="Your last go" />}
        {live !== null && <i className="you-live" style={{ left: at(live), background: MEASURE_COLOR[m] }} title="You, now" />}
      </span>
      <span className="you-nums">
        take {pc(target?.[m])} · you {pc(live ?? last?.[m])}
      </span>
    </div>
  );
}

/**
 * The singer beside the take: live readings from the microphone against the take's own, the last
 * go summed up in words, and every take of the lesson with the singer's go at it, so a change
 * between two takes (no twang, then twang) can be seen in their own voice.
 */
function YouPanel(props: { lesson: Lesson }) {
  const status = useMic((s) => s.status);
  const error = useMic((s) => s.error);
  const hearing = useMic((s) => s.hearing);
  const live = useMic((s) => s.live);
  const targets = useMic((s) => s.targets);
  const attempts = useMic((s) => s.attempts);
  const takeId = useCoach((s) => s.takeId);
  const playing = useCoach((s) => s.playing);
  if (status === "off") return null;
  const l = props.lesson;
  const take = l.takes.find((t) => t.id === takeId) ?? l.takes[0];
  const target = targets[take.id];
  const last = attempts[`${l.id}/${take.id}`];
  const steady = holdsOneNote(l, take);
  const on = status === "on" && !playing && live?.voiced ? live : null;
  const state =
    status === "error"
      ? `The microphone is off: ${error}.`
      : status === "asking"
        ? "Waiting for the browser's permission…"
        : status === "preparing"
          ? "Getting ready (a few seconds, the first time)…"
          : playing
            ? "The take is singing: listen."
            : hearing
              ? "Hearing you."
              : "Your turn: sing it back.";
  let pitch = "";
  if (on) {
    const near = Math.round(on.midi);
    pitch = noteName(midiHz(near));
    if (steady && target) {
      const c = Math.round(centsOff(on.midi, target.midi));
      pitch += ` · ${c === 0 ? "on" : `${Math.abs(c)} cent${Math.abs(c) === 1 ? "" : "s"} ${c < 0 ? "under" : "over"}`} the take's note`;
    }
  }
  const tried = l.takes.filter((t) => attempts[`${l.id}/${t.id}`]);
  return (
    <section className={`coach-you${status === "error" ? " failed" : ""}`} aria-label="You and the take">
      <div className="you-head">
        <h4>You and the take</h4>
        <span className={`you-state${hearing && !playing ? " hearing" : ""}`} role="status">
          {state}
        </span>
      </div>
      {status !== "error" && (
        <>
          <p className="you-now">{on ? `${on.vowel || "–"} on ${pitch}${on.vibExtent > 0 ? ` · vibrato ${on.vibRate.toFixed(1)}/s` : ""}` : "\u00a0"}</p>
          {MEASURES.map((m) => (
            <YouMeter key={m} m={m} target={target} last={last} live={on ? on[m] : null} />
          ))}
          {last && target && (
            <div className="you-advice">
              {advise(target, last, steady).map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          )}
          {tried.length > 0 && (
            <table className="you-table">
              <thead>
                <tr>
                  <th scope="col">Your go at</th>
                  {MEASURES.map((m) => (
                    <th key={m} scope="col" style={{ color: MEASURE_COLOR[m] }}>
                      {MEASURE_NAME[m]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tried.map((t) => {
                  const you = attempts[`${l.id}/${t.id}`];
                  const tg = targets[t.id];
                  return (
                    <tr key={t.id} className={t.id === take.id ? "on" : ""}>
                      <th scope="row">{t.label}</th>
                      {MEASURES.map((m) => (
                        <td key={m}>
                          {pc(you[m])} <i>({pc(tg?.[m])})</i>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="you-small">Tick: the take. Dot: you, now. Ring: your last go. In the table, the take's own reading is in brackets. The scales are set on recordings of trained singers (see docs/validation.md), and the take is the synthesizer measured the same way. They tell techniques apart best within one voice: trust the change between your own goes more than a single number.</p>
        </>
      )}
    </section>
  );
}

function LessonText(props: { lesson: Lesson }) {
  const l = props.lesson;
  return (
    <div className="coach-text">
      <section>
        <h4>What is happening</h4>
        {l.what.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </section>
      <section>
        <h4>How to find it</h4>
        {l.feel.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </section>
      <section>
        <h4>Practice</h4>
        {l.practice.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </section>
      {l.care && (
        <section className="coach-care">
          <h4>Take care</h4>
          <p>{l.care}</p>
        </section>
      )}
    </div>
  );
}

/** Coach's right column: the lessons, the chosen one with its takes, the folds and the spectrum. */
export function CoachRight() {
  const lessonId = useCoach((s) => s.lessonId);
  const lesson = lessonById(lessonId);
  // the chosen take is shown on the head as soon as the tab opens; the other tabs get their voice back after
  useEffect(() => {
    enterCoach();
    return () => {
      useMic.getState().off();
      leaveCoach();
    };
  }, []);
  // a new body has its own vowel shapes and home note
  const body = useStore((s) => s.body);
  useEffect(() => {
    if (!useCoach.getState().playing) enterCoach();
  }, [body]);
  return (
    <div className="right right-coach">
      <CoachActions />
      <Screen className="s-lessons" title="Lessons">
        <LessonList />
      </Screen>
      <Screen className="s-lesson" title={lesson.title} sub={lesson.tagline}>
        <Takes lesson={lesson} />
        <div className="coach-scroll">
          <YouPanel lesson={lesson} />
          <LessonText lesson={lesson} />
        </div>
      </Screen>
      <Screen className="s-folds" title="Vocal folds" sub="Slowed 100×">
        <Stroboscope />
      </Screen>
      <Screen className="s-spec" title="Spectrum" sub="Harmonics and resonance">
        <SpectrumView ring />
      </Screen>
    </div>
  );
}
