import { useEffect, useRef, useState } from "react";
import { useStore } from "../store.ts";
import { isSung, KIND, type VoiceTrack } from "../../analyze/analyze.ts";
import { read } from "../../analyze/describe.ts";
import { enterAnalyze, frameAt, leaveAnalyze, position, rematch, useAnalyze } from "../../analyze/store.ts";
import { drawCallouts, mouthCaption } from "../../coach/callouts.ts";
import type { PartId, ZoneId } from "../../coach/types.ts";
import { V } from "../colors.ts";
import { ActionBar, PrimaryButton } from "./ActionBar.tsx";
import type { InfoFn, OverlayFn, SlotsFn } from "./AnatomyView.tsx";
import { Segmented } from "./Controls.tsx";
import { Chip, Screen } from "./Screen.tsx";
import { SpectrumView } from "./SpectrumView.tsx";
import { Stroboscope } from "./Stroboscope.tsx";
import { Timeline, type TimelineView } from "./Timeline.tsx";

/** the analysis frame under the playhead, or null */
function nowFrame(): { t: VoiceTrack; i: number } | null {
  const t = useAnalyze.getState().track;
  return t ? { t, i: frameAt(t, position()) } : null;
}

/** Analyze's overlay on the head: what the recording is doing now, on the parts doing it. */
export const analyzeOverlay: OverlayFn = (ctx, r, m, f, a, size) => {
  const n = nowFrame();
  if (!n) return;
  const { t, i } = n;
  const s = useAnalyze.getState();
  const parts: PartId[] = [], zones: ZoneId[] = [];
  const k = m.tract.scale;
  if (t.kind[i] === KIND.breath) {
    parts.push("breath");
    mouthCaption(ctx, r, f, k, [{ text: "BREATH IN", color: V.white, size: 14 }]);
  } else if (t.kind[i] === KIND.harsh) {
    mouthCaption(ctx, r, f, k, [{ text: "HARSH", color: V.red, size: 14 }]);
  } else if (isSung(t, i)) {
    // The twang funnel and the false folds are not pointed at, however much ring or grit there is:
    // the sound does not say which part made it (Coach's lessons, where it is known, do point).
    if (t.press[i] > 0.85 || t.breath[i] > 0.5) parts.push("folds");
    // ring is felt in the mask; chest and head are not marked, since the sound alone does not say which register it is
    if (t.ring[i] > 0.45) zones.push("mask");
    const rd = read(t, i);
    mouthCaption(ctx, r, f, k, [
      { text: vowelText(t, i), color: V.green, size: 22 },
      { text: rd.note, color: V.amber, size: 15 },
    ]);
  }
  drawCallouts(ctx, r, m, f, a, size.dt, parts, zones, s.playing);
};

/** The vowel at a frame: its name, or the two it lies between ("AH/OH"); "?" where the pitch is too high to tell. */
export function vowelText(t: VoiceTrack, i: number): string {
  if (t.vowel[i] === 255) return "";
  if (t.sure[i] < 0.5) return "?";
  const name = t.vowelNames[t.vowel[i]];
  return t.vowelNear[i] !== 255 ? `${name}/${t.vowelNames[t.vowelNear[i]]}` : name;
}

/** The formants measured at the playhead, for the head's F1-F3 readout (null where nothing is sung). */
export const analyzeFormants = (): number[] | null => {
  const n = nowFrame();
  if (!n || !isSung(n.t, n.i)) return null;
  const f = [n.t.formants[n.i * 3], n.t.formants[n.i * 3 + 1], n.t.formants[n.i * 3 + 2]];
  return f.every((v) => v > 0) ? f : null;
};

const pct = (v: number) => String(Math.round(100 * v));

/** Analyze's four readouts under the chin. */
export const analyzeSlots: SlotsFn = () => {
  const n = nowFrame();
  const on = n && isSung(n.t, n.i);
  const t = n?.t, i = n?.i ?? 0;
  return [
    { label: "Drive", value: on ? pct(t!.press[i]) : "-", unit: on ? "%" : "", color: V.white },
    { label: "Ring", value: on ? pct(t!.ring[i]) : "-", unit: "%", color: V.pink },
    { label: "Air", value: on ? pct(t!.breath[i]) : "-", unit: "%", color: V.blue },
    { label: "Grit", value: on ? pct(t!.grit[i]) : "-", unit: "%", color: V.red },
  ];
};

/** Analyze's lines under the formants. */
export const analyzeInfo: InfoFn = () => {
  const n = nowFrame();
  if (!n) return ["No recording"];
  const rd = read(n.t, n.i);
  if (rd.kind !== "voiced") return [rd.kind === "breath" ? "Breath in" : rd.kind === "harsh" ? "Harsh, no pitch" : rd.kind === "noise" ? "Consonant" : "Silence"];
  // the formants above are measured; the shape drawn is one that would give them
  return [`Note ${rd.note} ${rd.hz.toFixed(0)} Hz`, "Formants measured", n.t.sure[n.i] < 0.5 ? "Vowel unsure this high" : "Shape drawn to fit"];
};

/** re-render about 12 times a second while Analyze is open (the playhead moves outside React) */
function useTick(ms = 80): void {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((x) => (x + 1) % 1e6), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function Meter(props: { name: string; value: number | null; color: string; ends?: [string, string]; hint: string }) {
  const v = props.value;
  return (
    <div className="an-meter" title={props.hint}>
      <span className="an-meter-name" style={{ color: props.color }}>
        {props.name}
      </span>
      <span className="an-meter-bar">
        {props.ends ? v !== null && <i className="an-meter-dot" style={{ left: `${Math.round(v * 100)}%`, background: props.color }} /> : <i className="an-meter-fill" style={{ width: `${v === null ? 0 : Math.round(v * 100)}%`, background: props.color }} />}
        {props.ends && <i className="an-meter-mid" />}
      </span>
      <span className="an-meter-ends">{props.ends ? `${props.ends[0]} ↔ ${props.ends[1]}` : v === null ? "" : `${Math.round(v * 100)} %`}</span>
    </div>
  );
}

/** What the voice is doing at the playhead, in words and meters. */
function NowPanel() {
  useTick();
  const n = nowFrame();
  if (!n) return <div className="an-now" />;
  const { t, i } = n;
  const rd = read(t, i);
  const on = rd.kind === "voiced";
  return (
    <div className="an-now">
      <div className="an-now-top">
        <div className="an-big">
          <span className="an-big-label">Note</span>
          <b className="an-note">{on ? rd.note : "–"}</b>
          <span className="an-big-sub">{on ? `${rd.cents >= 0 ? "+" : ""}${rd.cents} cents · ${rd.hz.toFixed(0)} Hz` : rd.kind === "breath" ? "breath in" : rd.kind === "harsh" ? "harsh, no pitch" : rd.kind === "noise" ? "consonant" : "silence"}</span>
        </div>
        <div className="an-big">
          <span className="an-big-label">Vowel</span>
          <b className="an-vowel">{on && t.vowel[i] !== 255 ? vowelText(t, i) : "–"}</b>
          <span className="an-big-sub">{on && t.vowel[i] !== 255 ? (t.sure[i] < 0.5 ? "too high to tell" : `F1 ${Math.round(t.formants[i * 3])} · F2 ${Math.round(t.formants[i * 3 + 1])}`) : ""}</span>
        </div>
      </div>
      <p className="an-words">{on ? rd.words.join(" · ") : rd.words.join(" ") || " "}</p>
      <Meter name="Drive" value={on ? t.press[i] : null} color="var(--white)" ends={["soft", "hard"]} hint="How hard the voice is driven: how strong the upper harmonics are against the lowest. Set on trained singers: left is their soft and breathy singing, right their belt and forte. Loudness and firm fold closure both raise it, and the sound alone cannot tell them apart." />
      <Meter name="Ring" value={on ? t.ring[i] : null} color="var(--pink)" hint="How much of the sound is in the 2 to 4 kHz band, set on the same singers' belt against their soft singing. Twang raises it and so does driving harder: the sound alone cannot tell which. EE and EH have more of it than OO, so compare the same vowel." />
      <Meter name="Air" value={on ? t.breath[i] : null} color="var(--blue)" hint="Breathiness: hiss between the upper harmonics and a strong first harmonic. Set on trained singers' breathy singing against their straight tone." />
      <Meter name="Grit" value={on ? t.grit[i] : null} color="var(--red)" hint="Rattle between the low harmonics, or a second pitch under the note: rasp, growl, fry, distortion. Set on vocal fry and metal vocalists' distortion against ordinary singing. A very breathy voice can read part-way up it." />
      <p className="an-vib">{on ? (t.vibExtent[i] > 0 ? `Vibrato ${t.vibRate[i].toFixed(1)} per second, ±${Math.round(t.vibExtent[i])} cents` : "Straight tone") : " "}</p>
    </div>
  );
}

/** The file chooser, as a framed button. */
function OpenButton(props: { isolate: boolean; label?: string; primary?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const open = useAnalyze((s) => s.open);
  return (
    <>
      <input
        ref={input}
        className="an-file"
        type="file"
        accept="audio/*,video/mp4,.wav,.mp3,.flac,.m4a,.ogg,.aiff,.aif"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void open(f, props.isolate);
          e.target.value = "";
        }}
      />
      <Chip toggle={false} className={props.primary ? "an-open primary" : "an-open"} onClick={() => input.current?.click()} title="Open a recording from this computer. Nothing is uploaded: it is analysed here.">
        {props.label ?? "Open…"}
      </Chip>
    </>
  );
}

function AnalyzeActions(props: { isolate: boolean; setIsolate: (v: boolean) => void }) {
  const status = useAnalyze((s) => s.status);
  const playing = useAnalyze((s) => s.playing);
  const rate = useAnalyze((s) => s.rate);
  const mix = useAnalyze((s) => s.mix);
  const heard = useAnalyze((s) => s.heard);
  const hasFull = useAnalyze((s) => s.hasFull);
  const canIsolate = useAnalyze((s) => s.canIsolate);
  const { toggle, setRate, setMix, setHeard } = useAnalyze.getState();
  return (
    <ActionBar label="Recording" onSpace={toggle}>
      <PrimaryButton label="Play" playing={playing} busy={status === "working" ? "Working…" : null} onClick={toggle} title="Play the recording (Space)" />
      <OpenButton isolate={props.isolate} />
      <Chip
        on={props.isolate}
        disabled={canIsolate === false}
        onClick={() => props.setIsolate(!props.isolate)}
        title={canIsolate === false ? "Splitting a full track needs the local helper: start the app with `bun run dev` after `bun run setup:separate` (see the README)." : "On: the file is a full track, and the vocal is isolated from the band first. Off: the file is already a vocal on its own."}
      >
        Full track
      </Chip>
      <Segmented<string> label="Speed" value={String(rate)} onChange={(v) => setRate(Number(v))} options={[{ value: "1", label: "100%" }, { value: "0.75", label: "75%" }, { value: "0.5", label: "50%" }]} />
      {hasFull && <Segmented<"vocal" | "full"> label="Hear" value={heard} onChange={setHeard} options={[{ value: "vocal", label: "Vocal" }, { value: "full", label: "Full track" }]} />}
      <label className="an-mix" title="Left: the recording. Right: the synthesizer singing what was measured (vowels and pitch only: it does not say the words). In between, both.">
        <span>Recording</span>
        <input type="range" min={0} max={1} step={0.01} value={mix} onChange={(e) => setMix(Number(e.target.value))} style={{ "--pos": `${mix * 100}%` } as React.CSSProperties} aria-label="Mix between the recording and the model voice" />
        <span>Model</span>
      </label>
    </ActionBar>
  );
}

/** What the timeline screen shows before there is a recording, while one is read, and when that failed. */
function Placeholder(props: { isolate: boolean }) {
  const status = useAnalyze((s) => s.status);
  const stage = useAnalyze((s) => s.stage);
  const progress = useAnalyze((s) => s.progress);
  const error = useAnalyze((s) => s.error);
  const demo = useAnalyze((s) => s.demo);
  if (status === "working")
    return (
      <div className="an-empty" role="status">
        <p className="an-stage">{stage || "Working"}…</p>
        <div className="an-progress">
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      </div>
    );
  return (
    <div className="an-empty">
      {status === "error" && (
        <p className="an-error" role="alert">
          That did not work: {error}
        </p>
      )}
      <h3>See how a recording is sung</h3>
      <p>Open a vocal (a stem, an a cappella, or yourself) and the head sings along with it: the pitch, the vowel, how hard the voice is driven, the ring, the air and the grit, moment by moment.</p>
      <p>
        For a full track, switch on <b>Full track</b> first and the vocal is isolated from the band before it is analysed.
      </p>
      <div className="an-empty-row">
        <OpenButton isolate={props.isolate} label="Open a recording…" primary />
        <Chip toggle={false} onClick={() => void demo()}>
          Or try the demo
        </Chip>
      </div>
      <p className="an-note-small">Nothing leaves this computer. Measured from the sound: pitch, vibrato, the vowel's resonances, and four scales (drive, ring, air, grit) set on recordings of singers whose technique is known. Drawn, not measured: the tongue, jaw and lips are a shape that would give those resonances, not an X-ray, and the folds are the model's. Consonants are not followed.</p>
    </div>
  );
}

/** Analyze's right column. */
export function AnalyzeRight() {
  const status = useAnalyze((s) => s.status);
  const name = useAnalyze((s) => s.name);
  const loop = useAnalyze((s) => s.loop);
  const track = useAnalyze((s) => s.track);
  const [isolate, setIsolate] = useState(false);
  const view = useRef<TimelineView>({ span: 14, t0: 0 });
  const body = useStore((s) => s.body);
  useEffect(() => {
    enterAnalyze();
    return leaveAnalyze;
  }, []);
  // another body: the same recording against that body's shapes
  useEffect(() => {
    void rematch();
  }, [body]);
  // a new recording starts zoomed to its first stretch
  useEffect(() => {
    if (track) view.current = { span: Math.min(14, track.duration), t0: 0 };
  }, [track]);
  const zoom = (f: number) => {
    const t = useAnalyze.getState().track;
    if (!t) return;
    const v = view.current;
    const centre = Math.min(Math.max(position(), v.t0), v.t0 + v.span);
    const span = Math.max(2, Math.min(t.duration, v.span * f));
    view.current = { span, t0: centre - ((centre - v.t0) / v.span) * span };
  };
  const ready = status === "ready" && track;
  return (
    <div
      className="right right-analyze"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) void useAnalyze.getState().open(f, isolate);
      }}
    >
      <AnalyzeActions isolate={isolate} setIsolate={setIsolate} />
      <Screen
        className="s-time"
        title={ready ? "Recording" : "Analyze"}
        sub={ready ? (name ?? "") : "A recording, seen"}
        tools={
          ready ? (
            <>
              {loop && (
                <Chip toggle={false} onClick={() => useAnalyze.getState().setLoop(null)}>
                  Clear loop
                </Chip>
              )}
              <Chip toggle={false} onClick={() => zoom(1.6)} aria-label="Zoom out">
                −
              </Chip>
              <Chip toggle={false} onClick={() => zoom(1 / 1.6)} aria-label="Zoom in">
                +
              </Chip>
              <Chip toggle={false} onClick={() => zoom(1000)}>
                All
              </Chip>
            </>
          ) : undefined
        }
      >
        {ready ? <Timeline view={view} /> : <Placeholder isolate={isolate} />}
      </Screen>
      <Screen className="s-now" title="Right now" sub="At the playhead">
        <NowPanel />
      </Screen>
      <Screen className="s-folds" title="Vocal folds" sub="The model's">
        <Stroboscope />
      </Screen>
      <Screen className="s-spec" title="Spectrum" sub="Recording and model">
        <SpectrumView ring />
      </Screen>
    </div>
  );
}
