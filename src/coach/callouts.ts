/**
 * Coach's drawing over the head: a labelled marker on each part the take is about, a soft glow
 * where the singer feels the vibration, and readouts chosen for the lesson.
 */
import type { InfoFn, OverlayFn, SlotsFn } from "../ui/components/AnatomyView.tsx";
import { nearestVowel } from "../ui/components/AnatomyView.tsx";
import { noteName } from "../ui/components/VoiceControls.tsx";
import { jawFn } from "../ui/render/profile.ts";
import { label, labelWidth, ring, seg } from "../ui/render/vector.ts";
import type { Slot } from "../ui/render/readouts.ts";
import { V, mix } from "../ui/colors.ts";
import { useStore } from "../ui/store.ts";
import type { VoiceModel } from "../ui/analysis.ts";
import type { HumanArtic, HumanFrame } from "../wasm/types.ts";
import type { TelemetryMessage } from "../worklet/protocol.ts";
import { activeParts, activeZones, currentTake, useCoach } from "./player.ts";
import type { PartId, ZoneId } from "./types.ts";

interface Vec {
  x: number;
  y: number;
}

/** A point `s` cm up the tube from the folds (the epilarynx runs up toward the first grid line). */
function upTube(f: HumanFrame, s: number): Vec {
  const g = f.grid[0];
  const dx = g.mid.x - f.glottis.x, dy = g.mid.y - f.glottis.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: f.glottis.x + (dx / len) * s, y: f.glottis.y + (dy / len) * s };
}

/** the tract's centre line at `s` cm from the folds */
function midAt(f: HumanFrame, s: number): Vec {
  let best = f.grid[0];
  for (const g of f.grid) if (Math.abs(g.s - s) < Math.abs(best.s - s)) best = g;
  return best.mid;
}

interface PartSpec {
  name: string;
  /** where the part is (body cm) */
  at: (m: VoiceModel, f: HumanFrame, a: HumanArtic) => Vec;
  /** where its label sits, from the part (cm; +x toward the face, +y up) */
  dx: number;
  dy: number;
  align: "left" | "right";
  /** marker radius (cm) */
  r: number;
  color: string;
}

const PARTS: Record<PartId, PartSpec> = {
  breath: { name: "Breath pressure", at: (m, f) => ({ x: f.glottis.x + 0.1 * m.tract.scale, y: f.glottis.y - 2.3 * m.tract.scale }), dx: -1.5, dy: -0.2, align: "right", r: 0.55, color: V.amber },
  folds: { name: "Vocal folds", at: (_m, f) => f.glottis, dx: -1.5, dy: -0.5, align: "right", r: 0.42, color: V.white },
  falseFolds: { name: "False folds", at: (m, f) => upTube(f, 1.0 * m.tract.scale), dx: -1.5, dy: 0.1, align: "right", r: 0.36, color: V.red },
  twang: { name: "Twang funnel", at: (m, f) => upTube(f, 1.9 * m.tract.scale), dx: -1.5, dy: 0.6, align: "right", r: 0.45, color: V.pink },
  larynx: { name: "Larynx", at: (m, f) => ({ x: f.glottis.x + 1.2 * m.tract.scale, y: f.glottis.y }), dx: -2.7, dy: -1.3, align: "right", r: 0.5, color: V.blue },
  throat: { name: "Throat space", at: (m, f) => midAt(f, 5.2 * m.tract.scale), dx: -1.7, dy: 0.3, align: "right", r: 0.6, color: V.blue },
  softPalate: { name: "Soft palate", at: (_m, f) => f.velum[Math.floor(f.velum.length * 0.45)], dx: -1.6, dy: 1.3, align: "right", r: 0.55, color: V.white },
  nose: { name: "Nose", at: (_m, f) => f.nasalCavity[Math.floor(f.nasalCavity.length * 0.55)], dx: 1.3, dy: 1.5, align: "left", r: 0.6, color: V.white },
  tongue: { name: "Tongue", at: (_m, f) => ({ x: f.tongueCenter.x + 0.35 * f.tongueRadius, y: f.tongueCenter.y + 0.75 * f.tongueRadius }), dx: 3.6, dy: -4.6, align: "left", r: 0.45, color: V.green },
  tongueRoot: { name: "Tongue root", at: (_m, f) => ({ x: f.tongueCenter.x - 0.8 * f.tongueRadius, y: f.tongueCenter.y - 0.45 * f.tongueRadius }), dx: -1.9, dy: -0.9, align: "right", r: 0.5, color: V.green },
  jaw: { name: "Jaw", at: (m, _f, a) => jawFn(m, a)(7.5, 4.9), dx: 1.0, dy: -0.7, align: "left", r: 0.45, color: V.red },
  lips: { name: "Lips", at: (_m, f) => ({ x: (f.upperLip[6].x + f.lowerLip[6].x) / 2 + 0.15, y: (f.upperLip[6].y + f.lowerLip[6].y) / 2 }), dx: 1.5, dy: 0.2, align: "left", r: 0.55, color: V.pink },
};

interface ZoneSpec {
  name: string;
  /** centre and radii (cm, male template; scaled with the body) */
  x: number;
  y: number;
  rx: number;
  ry: number;
  /** label offset (cm) */
  lx: number;
  ly: number;
  align: "left" | "right" | "center";
}

const ZONES: Record<ZoneId, ZoneSpec> = {
  chest: { name: "Felt in the chest", x: 0.6, y: -3.9, rx: 3.2, ry: 1.6, lx: 0, ly: 0, align: "center" },
  throat: { name: "Felt in the throat", x: -0.2, y: 3.1, rx: 1.7, ry: 2.6, lx: -2.1, ly: -3.2, align: "right" },
  mouth: { name: "Felt in the mouth", x: 3.9, y: 8.1, rx: 2.6, ry: 1.2, lx: 5.2, ly: 0.2, align: "left" },
  mask: { name: "Felt in the mask", x: 6.0, y: 11.3, rx: 2.3, ry: 1.9, lx: 3.4, ly: 2.5, align: "left" },
  head: { name: "Felt in the head", x: 1.5, y: 16.0, rx: 3.6, ry: 2.4, lx: 0, ly: 3.0, align: "center" },
};

/** a small caption with a dark plate behind it, so it reads over the anatomy's lines */
function tag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, align: "left" | "right" | "center", size = 12.5): { x0: number; x1: number } {
  const w = labelWidth(ctx, text, { size, ls: 0.16, weight: "m" });
  const x0 = align === "left" ? x : align === "right" ? x - w : x - w / 2;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(0, 0, 0, 0.78)";
  ctx.fillRect(x0 - 5, y - size - 2, w + 10, size + 8);
  ctx.restore();
  label(ctx, text, x0, y, { size, color: mix(color, "#ffffff", 0.35), ls: 0.16, weight: "m" });
  return { x0: x0 - 5, x1: x0 + w + 5 };
}

let clock = 0;

/** Coach's overlay on the 2D head. */
export const coachOverlay: OverlayFn = (ctx, r, m, f, a, size) => {
  clock += size.dt;
  const k = m.tract.scale;
  const px = r.pxPerCm;
  const playing = useCoach.getState().playing !== null;
  const pulse = 0.5 + 0.5 * Math.sin(clock * 4.2);

  // where it is felt: a soft amber glow that breathes while the take sounds
  for (const id of activeZones()) {
    const z = ZONES[id];
    const cx = r.X({ x: z.x * k, y: 0 }), cy = r.Y({ x: 0, y: z.y * k });
    const rx = z.rx * k * px, ry = z.ry * k * px;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    const peak = playing ? 0.2 + 0.14 * pulse : 0.13;
    g.addColorStop(0, `rgba(255, 179, 64, ${peak})`);
    g.addColorStop(0.6, `rgba(255, 179, 64, ${peak * 0.45})`);
    g.addColorStop(1, "rgba(255, 179, 64, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const lx = r.X({ x: (z.x + z.lx) * k, y: 0 }), ly = r.Y({ x: 0, y: (z.y + z.ly) * k });
    tag(ctx, z.name.toUpperCase(), lx, ly, V.amber, z.align, 11.5);
  }

  // the parts the take is about
  for (const id of activeParts()) {
    const p = PARTS[id];
    const pos = p.at(m, f, a);
    const x = r.X(pos), y = r.Y(pos);
    const rad = p.r * k * px;
    ring(ctx, x, y, rad, p.color, 2, { hot: true, alpha: 0.95 });
    ring(ctx, x, y, rad + 4 + 3 * pulse, p.color, 1, { alpha: playing ? 0.25 + 0.3 * pulse : 0.3 });
    const lx = x + p.dx * k * px, ly = y - p.dy * k * px;
    const box = tag(ctx, p.name.toUpperCase(), lx, ly, p.color, p.align);
    // leader from the label's near end to the rim of the marker
    const ex = p.align === "left" ? box.x0 : box.x1, ey = ly - 4;
    const d = Math.hypot(ex - x, ey - y) || 1;
    seg(ctx, x + ((ex - x) / d) * rad, y + ((ey - y) / d) * rad, ex, ey, p.color, 1.2, { alpha: 0.85 });
  }
};

const signedCm = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;

/**
 * Share of the cycle the folds spend shut, from the glottal area trace: null when silent, and
 * "leak" when they never meet (the gap left at their closest is more than the small chink at the
 * back that every voice has).
 */
export function closedShare(area: ArrayLike<number>, scale: number): number | "leak" | null {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < area.length; i++) {
    mn = Math.min(mn, area[i]);
    mx = Math.max(mx, area[i]);
  }
  if (!(mx - mn > 0.004)) return null;
  if (mn > 0.03 * scale * scale) return "leak";
  const thr = mn + 0.06 * (mx - mn);
  let closed = 0;
  for (let i = 0; i < area.length; i++) if (area[i] <= thr) closed++;
  return closed / area.length;
}

/** One readout per part, in the part's colour. */
function slotFor(id: PartId, m: VoiceModel, a: HumanArtic, f: HumanFrame, formants: number[], tele: TelemetryMessage | null): Slot {
  switch (id) {
    case "breath": {
      const p = tele ? tele.t.pLung : 0;
      return { label: "Lung pressure", value: tele && tele.t.gate > 0.02 ? p.toFixed(1) : "-", unit: "cmH₂O", color: V.amber };
    }
    case "folds": {
      const c = tele && tele.t.voicing > 0.3 ? closedShare(tele.t.glottalArea, m.tract.scale) : null;
      if (c === "leak") return { label: "Folds shut", value: "Never", unit: "leaking air", color: V.white };
      return { label: "Folds shut", value: c === null ? "-" : String(Math.round(c * 100)), unit: "% of cycle", color: V.white };
    }
    case "falseFolds":
      return { label: "False folds", value: String(Math.round(a.ventricular * 100)), unit: "% in", color: V.red };
    case "twang":
      return { label: "Twang", value: String(Math.round(a.epilarynx * 100)), unit: "%", color: V.pink };
    case "larynx":
    case "throat":
      return { label: "Larynx", value: signedCm(a.larynx), unit: "cm", color: V.blue };
    case "softPalate":
    case "nose":
      return f.velumPort > 0.02 ? { label: "Soft palate", value: f.velumPort.toFixed(2), unit: "cm² open", color: V.white } : { label: "Soft palate", value: "Shut", color: V.white };
    case "tongue":
      return formants.length >= 2 ? { label: "Vowel", value: nearestVowel(m, formants[0], formants[1]), color: V.green, ipa: true } : { label: "Vowel", value: "-", color: V.green };
    case "tongueRoot":
      return { label: "Tongue root", value: signedCm(a.root), unit: "cm", color: V.green };
    case "jaw":
      return { label: "Jaw", value: a.jaw.toFixed(1), unit: "cm", color: V.red };
    case "lips":
      return { label: "Lips", value: a.lipAp.toFixed(1), unit: "cm", color: V.pink };
  }
}

/** Coach's four readouts: the take's parts first, then the ones every lesson can use. */
export const coachSlots: SlotsFn = (m, a, f, formants, tele) => {
  const order: PartId[] = [...activeParts(), "folds", "breath", "larynx", "twang", "softPalate"];
  const out: Slot[] = [];
  for (const id of order) {
    const s = slotFor(id, m, a, f, formants, tele);
    if (!out.some((o) => o.label === s.label)) out.push(s);
    if (out.length === 4) break;
  }
  return out;
};

/** Coach's lines under the formants: what is being sung, and the note. */
export const coachInfo: InfoFn = (_m, f, tele) => {
  const take = currentTake();
  const out = [take.label];
  if (tele && tele.t.voicing > 0.3) out.push(`Note ${noteName(tele.t.f0)} ${tele.t.f0.toFixed(0)} Hz`);
  else out.push(`Note ${noteName(useStore.getState().source.f0)}`);
  out.push(`Tract ${f.length.toFixed(1)} cm`);
  return out;
};
