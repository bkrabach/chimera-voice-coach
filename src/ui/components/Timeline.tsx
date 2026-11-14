import { useRef } from "react";
import { usePhosphor } from "../usePhosphor.ts";
import { TEXT, V } from "../colors.ts";
import { beam, label, labelWidth, seg } from "../render/vector.ts";
import { KIND, type VoiceTrack } from "../../analyze/analyze.ts";
import { position, useAnalyze } from "../../analyze/store.ts";
import { noteName } from "./VoiceControls.tsx";

const hzToMidi = (f: number) => 69 + 12 * Math.log2(f / 440);
const GUTTER = 74;

interface Lane {
  id: "pitch" | "vowel" | "press" | "ring" | "breath" | "grit" | "level";
  name: string;
  share: number;
  color: string;
}

const LANES: Lane[] = [
  { id: "pitch", name: "Pitch", share: 0.4, color: V.amber },
  { id: "vowel", name: "Vowel", share: 0.1, color: V.green },
  { id: "press", name: "Closure", share: 0.11, color: V.white },
  { id: "ring", name: "Ring", share: 0.1, color: V.pink },
  { id: "breath", name: "Air", share: 0.09, color: V.blue },
  { id: "grit", name: "Grit", share: 0.1, color: V.red },
  { id: "level", name: "Level", share: 0.1, color: V.amber },
];

/** The view: which stretch of the recording the lanes show. Kept by the caller so its zoom buttons can change it. */
export interface TimelineView {
  /** seconds shown */
  span: number;
  /** start of the view (s) */
  t0: number;
}

/** The pitch range worth showing: the notes the recording uses, with a little room. */
function pitchRange(t: VoiceTrack): [number, number] {
  const v: number[] = [];
  for (let i = 0; i < t.n; i += 2) if (t.note[i] > 0) v.push(hzToMidi(t.note[i]));
  if (!v.length) return [48, 72];
  v.sort((a, b) => a - b);
  let lo = Math.floor(v[Math.floor(v.length * 0.02)]) - 2, hi = Math.ceil(v[Math.floor(v.length * 0.98)]) + 2;
  if (hi - lo < 12) {
    const mid = (hi + lo) / 2;
    lo = Math.floor(mid - 6);
    hi = Math.ceil(mid + 6);
  }
  return [lo, hi];
}

/**
 * The recording over time: the pitch, the vowel, and a lane each for how the folds close, the
 * ring, the air, the grit and the level. Click to move the playhead; drag to loop a stretch
 * (double-click clears it). The strip along the top is the whole recording.
 */
export function Timeline(props: { view: React.MutableRefObject<TimelineView> }) {
  const range = useRef<{ track: VoiceTrack | null; r: [number, number] }>({ track: null, r: [48, 72] });
  const drag = useRef<{ x0: number; t0: number; moved: boolean; overview: boolean } | null>(null);
  const geo = useRef({ w: 0, h: 0, top: 0 });

  const ref = usePhosphor(({ ctx, w, h }) => {
    const s = useAnalyze.getState();
    const t = s.track;
    if (!t) return;
    const view = props.view.current;
    const now = position();
    const dur = t.duration;
    view.span = Math.max(2, Math.min(dur, view.span));
    // follow the playhead while it plays; keep it in view when it is moved
    if (s.playing) {
      if (now > view.t0 + 0.85 * view.span || now < view.t0) view.t0 = now - 0.12 * view.span;
    } else if (!drag.current && (now > view.t0 + view.span || now < view.t0)) view.t0 = now - 0.3 * view.span;
    view.t0 = Math.max(0, Math.min(Math.max(0, dur - view.span), view.t0));
    const x0 = GUTTER, x1 = w - 10;
    const X = (sec: number) => x0 + ((sec - view.t0) / view.span) * (x1 - x0);
    const overH = 22, top = overH + 16, bottom = h - 16;
    geo.current = { w, h, top };

    // ---- the whole recording along the top
    const OX = (sec: number) => x0 + (sec / dur) * (x1 - x0);
    const env = new Path2D();
    const stepO = Math.max(1, Math.floor(t.n / (x1 - x0)));
    for (let i = 0; i < t.n; i += stepO) {
      let mx = -120;
      for (let j = i; j < Math.min(t.n, i + stepO); j++) if (t.kind[j] === KIND.voiced && t.level[j] > mx) mx = t.level[j];
      if (mx < -100) continue;
      const a = Math.max(0, Math.min(1, (mx + 60) / 55));
      const x = OX(i * t.hop);
      env.moveTo(x, 4 + overH);
      env.lineTo(x, 4 + overH - a * overH);
    }
    beam(ctx, env, V.amber, 1, { alpha: 0.55 });
    const win = new Path2D();
    win.rect(OX(view.t0), 3, Math.max(3, OX(view.t0 + view.span) - OX(view.t0)), overH + 2);
    beam(ctx, win, V.blue, 1, { alpha: 0.9 });
    seg(ctx, OX(now), 1, OX(now), overH + 7, V.white, 1.3);
    label(ctx, "ALL", 8, overH - 2, { size: 9, color: TEXT.secondary, ls: 0.16 });

    // ---- lanes
    const avail = bottom - top;
    let y = top;
    const lanes = LANES.map((l) => {
      const hh = l.share * avail;
      const o = { ...l, y0: y + 3, y1: y + hh - 3 };
      y += hh;
      return o;
    });
    if (range.current.track !== t) range.current = { track: t, r: pitchRange(t) };
    const [mLo, mHi] = range.current.r;

    const i0 = Math.max(0, Math.floor(view.t0 / t.hop)), i1 = Math.min(t.n - 1, Math.ceil((view.t0 + view.span) / t.hop));
    const step = Math.max(1, Math.floor((i1 - i0) / (2.5 * (x1 - x0))));

    // loop region behind everything
    if (s.loop) {
      const a = Math.max(x0, X(s.loop[0])), b = Math.min(x1, X(s.loop[1]));
      if (b > a) {
        ctx.save();
        ctx.fillStyle = "rgba(79, 182, 242, 0.09)";
        ctx.fillRect(a, top, b - a, bottom - top);
        ctx.restore();
        seg(ctx, a, top, a, bottom, V.blue, 1, { alpha: 0.8 });
        seg(ctx, b, top, b, bottom, V.blue, 1, { alpha: 0.8 });
        label(ctx, "LOOP", a + 4, top + 10, { size: 9, color: V.blue, ls: 0.16 });
      }
    }

    for (const l of lanes) {
      seg(ctx, x0, l.y1 + 3, x1, l.y1 + 3, V.frame, 1);
      label(ctx, l.name.toUpperCase(), 8, (l.y0 + l.y1) / 2 + 3, { size: 9.5, color: l.id === "pitch" || l.id === "vowel" || l.id === "level" ? TEXT.secondary : l.color, ls: 0.16 });
      if (l.id === "pitch") {
        const Y = (midi: number) => l.y1 - ((midi - mLo) / (mHi - mLo)) * (l.y1 - l.y0);
        // semitone grid; the Cs and the edges are named
        const every = mHi - mLo > 30 ? 12 : mHi - mLo > 18 ? 3 : 1;
        for (let m = Math.ceil(mLo); m <= mHi; m++) {
          const isC = ((m % 12) + 12) % 12 === 0;
          if (!isC && (m - Math.ceil(mLo)) % every !== 0) continue;
          seg(ctx, x0, Y(m), x1, Y(m), isC ? V.blueDim : V.frame, 1, { alpha: isC ? 0.9 : 0.7 });
          if (isC || every > 1 || m % 2 === 0) label(ctx, noteName(440 * Math.pow(2, (m - 69) / 12)), x0 - 5, Y(m) + 3, { size: 8.5, color: TEXT.secondary, align: "right", ls: 0.04 });
        }
        // the contour, coloured by what the voice is doing: gritty red, light blue, otherwise amber
        const paths = [new Path2D(), new Path2D(), new Path2D()];
        let prevClass = -1, prevI = -10;
        for (let i = i0; i <= i1; i += step) {
          if (!(t.f0[i] > 0)) continue;
          const cls = t.grit[i] > 0.35 ? 0 : t.press[i] < 0.25 ? 1 : 2;
          const x = X(i * t.hop), yy = Y(hzToMidi(t.f0[i]));
          if (cls === prevClass && i - prevI <= 2 * step) paths[cls].lineTo(x, yy);
          else paths[cls].moveTo(x, yy);
          prevClass = cls;
          prevI = i;
        }
        beam(ctx, paths[2], V.amber, 1.7, { hot: true });
        beam(ctx, paths[1], V.blue, 1.7, { hot: true });
        beam(ctx, paths[0], V.red, 1.9, { hot: true });
        // breaths and unvoiced sounds along the bottom
        for (let i = i0; i <= i1; i++) {
          if (t.kind[i] !== KIND.breath || (i > i0 && t.kind[i - 1] === KIND.breath)) continue;
          let j = i;
          while (j < t.n && t.kind[j] === KIND.breath) j++;
          const a = X(i * t.hop), b = X(j * t.hop);
          seg(ctx, a, l.y1 - 3, b, l.y1 - 3, V.white, 2, { alpha: 0.8 });
          if (b - a > 8) label(ctx, "BREATH", (a + b) / 2, l.y1 - 8, { size: 8, color: V.white, align: "center", ls: 0.12 });
        }
        continue;
      }
      if (l.id === "vowel") {
        // runs of one vowel, named where there is room
        let i = i0;
        let lastEnd = -Infinity, lastVowel = -1;
        while (i <= i1) {
          const v = t.vowel[i];
          if (v === 255) {
            i++;
            continue;
          }
          let j = i;
          while (j <= i1 && t.vowel[j] === v) j++;
          const name = t.vowelNames[v];
          const a = X(i * t.hop), b = X(j * t.hop);
          // a tick where the vowel changes; the same vowel carried on after a consonant has none
          if (v !== lastVowel) seg(ctx, a, l.y0 + 2, a, l.y1 - 2, V.green, 1, { alpha: 0.6 });
          seg(ctx, a, l.y1 - 2, b, l.y1 - 2, V.green, 1.2, { alpha: 0.75 });
          const tw = labelWidth(ctx, name, { size: 12, ls: 0.1 });
          const cx = Math.max(x0 + tw / 2, (a + b) / 2);
          if ((v !== lastVowel || cx - lastEnd > 90) && b - a > tw + 4 && cx - tw / 2 > lastEnd + 3) {
            label(ctx, name, cx, (l.y0 + l.y1) / 2 + 3, { size: 12, color: V.green, align: "center", ls: 0.1 });
            lastEnd = cx + tw / 2;
          }
          lastVowel = v;
          i = j;
        }
        continue;
      }
      // a 0..1 lane
      const src = l.id === "level" ? null : t[l.id];
      const Y = (v: number) => l.y1 - Math.max(0, Math.min(1, v)) * (l.y1 - l.y0);
      const p = new Path2D();
      let pen = false;
      for (let i = i0; i <= i1; i += step) {
        const on = l.id === "level" ? t.level[i] > -70 : t.f0[i] > 0 && t.entry[i] >= 0;
        if (!on) {
          pen = false;
          continue;
        }
        const v = src ? src[i] : (t.level[i] + 60) / 55;
        const x = X(i * t.hop);
        if (pen) p.lineTo(x, Y(v));
        else p.moveTo(x, Y(v));
        pen = true;
      }
      if (l.id === "press") {
        // the middle is an easy, balanced closure: lighter below, pressed above
        seg(ctx, x0, Y(0.5), x1, Y(0.5), V.frame, 1, { dash: [2, 4] });
        label(ctx, "PRESSED", x1 - 2, l.y0 + 7, { size: 7.5, color: TEXT.secondary, align: "right", ls: 0.12, alpha: 0.75 });
        label(ctx, "LIGHT", x1 - 2, l.y1 - 1, { size: 7.5, color: TEXT.secondary, align: "right", ls: 0.12, alpha: 0.75 });
      }
      beam(ctx, p, l.color, 1.4, { alpha: l.id === "level" ? 0.6 : 0.95 });
    }

    // what was sung, where that is known
    for (const m of s.marks) {
      if (m.t1 < view.t0 || m.t0 > view.t0 + view.span) continue;
      const a = Math.max(x0, X(m.t0)), b = Math.min(x1, X(m.t1));
      seg(ctx, a, top - 3, b, top - 3, V.white, 1, { alpha: 0.6 });
      seg(ctx, a, top - 6, a, top, V.white, 1, { alpha: 0.6 });
      const text = m.label.toUpperCase();
      const short = text.split(": ")[1] ?? text;
      const room = b - a - 6;
      const use = labelWidth(ctx, text, { size: 8.5, ls: 0.1 }) <= room ? text : labelWidth(ctx, short, { size: 8.5, ls: 0.1 }) <= room ? short : "";
      if (use) label(ctx, use, a + 4, top - 6, { size: 8.5, color: V.white, ls: 0.1 });
    }

    // seconds along the bottom
    const tick = view.span > 60 ? 10 : view.span > 25 ? 5 : view.span > 10 ? 2 : 1;
    for (let sec = Math.ceil(view.t0 / tick) * tick; sec <= view.t0 + view.span; sec += tick) {
      const x = X(sec);
      seg(ctx, x, bottom, x, bottom + 3, V.blueDim, 1);
      label(ctx, `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`, x, h - 3, { size: 8.5, color: TEXT.secondary, align: "center", ls: 0.06 });
    }

    // the playhead
    if (now >= view.t0 && now <= view.t0 + view.span) seg(ctx, X(now), top - 8, X(now), bottom, V.white, 1.3, { hot: true });
  });

  /** canvas x → seconds, in the lanes or in the strip along the top */
  const timeAt = (e: React.PointerEvent | React.MouseEvent): { t: number; overview: boolean } | null => {
    const t = useAnalyze.getState().track;
    const c = ref.current;
    if (!t || !c) return null;
    const r = c.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const u = Math.max(0, Math.min(1, (x - GUTTER) / (r.width - 10 - GUTTER)));
    const overview = y < geo.current.top - 10;
    const v = props.view.current;
    return { t: overview ? u * t.duration : v.t0 + u * v.span, overview };
  };

  const onDown = (e: React.PointerEvent) => {
    const at = timeAt(e);
    if (!at) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { x0: e.clientX, t0: at.t, moved: false, overview: at.overview };
    if (at.overview) useAnalyze.getState().seek(at.t);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const at = timeAt(e);
    if (!d || !at) return;
    if (d.overview) {
      const t = useAnalyze.getState().track!;
      const c = ref.current!.getBoundingClientRect();
      const u = Math.max(0, Math.min(1, (e.clientX - c.left - GUTTER) / (c.width - 10 - GUTTER)));
      useAnalyze.getState().seek(u * t.duration);
      return;
    }
    if (Math.abs(e.clientX - d.x0) > 6) d.moved = true;
    if (d.moved) useAnalyze.getState().setLoop([Math.min(d.t0, at.t), Math.max(d.t0, at.t)]);
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    if (!d || d.overview) return;
    const s = useAnalyze.getState();
    if (!d.moved) s.seek(d.t0);
    else if (s.loop) s.seek(s.loop[0]);
  };

  return (
    <canvas
      ref={ref}
      className="instrument-canvas timeline"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={() => useAnalyze.getState().setLoop(null)}
      role="img"
      aria-label="The recording over time: pitch, vowel, fold closure, ring, air, grit and level. Click to move the playhead, drag to loop a stretch, double-click to clear the loop."
    />
  );
}
