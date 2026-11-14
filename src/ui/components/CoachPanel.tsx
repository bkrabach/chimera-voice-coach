import { useEffect } from "react";
import { useStore } from "../store.ts";
import { enterCoach, leaveCoach, takeNote, useCoach, midiHz } from "../../coach/player.ts";
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
  const loop = useCoach((s) => s.loop);
  const key = useCoach((s) => s.key);
  const lessonId = useCoach((s) => s.lessonId);
  const takeId = useCoach((s) => s.takeId);
  const { play, playAll, stop, setLoop, setKey } = useCoach.getState();
  // the note depends on the body shown
  useStore((s) => s.body);
  const lesson = lessonById(lessonId);
  const take = lesson.takes.find((t) => t.id === takeId) ?? lesson.takes[0];
  const note = noteName(midiHz(takeNote(lesson, take)));
  const toggle = () => (playing ? stop() : play());
  return (
    <ActionBar label="Demonstrate" onSpace={toggle}>
      <PrimaryButton label="Sing it" playing={!!playing} onClick={toggle} title="Sing the chosen take (Space)" />
      <Chip toggle={false} on={tour} onClick={() => (tour ? stop() : playAll())} title="Sing every take of this lesson, one after another, to hear the differences">
        Compare all
      </Chip>
      <Chip on={loop} onClick={() => setLoop(!loop)} title="Repeat the take, with a breath between, so you can sing along">
        Loop
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
    return leaveCoach;
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
        <LessonText lesson={lesson} />
      </Screen>
      <Screen className="s-folds" title="Vocal folds" sub="From above, slowed 100×">
        <Stroboscope />
      </Screen>
      <Screen className="s-spec" title="Spectrum" sub="Harmonics under the tube's resonance">
        <SpectrumView ring />
      </Screen>
    </div>
  );
}
