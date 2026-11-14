/**
 * What Analyze reads on every take of every lesson: the engine sings each take as Coach does, and
 * the scales it measures are printed beside the take's name. A take must do what its words say
 * ("Twang" rings more than "No twang"), and this is the target a singer at the microphone is
 * compared with, so read this table after changing a lesson or Analyze.
 *
 * Usage: bun tools/coach-takes.ts [male|female] [lesson id …]
 */
import { initEngine } from "../tests/harness.ts";
import { OfflineVoice } from "./lib/voice.ts";

await initEngine();
const { buildCodebook } = await import("../src/analyze/codebook.ts");
const { analyze } = await import("../src/analyze/analyze.ts");
const { VoiceModel } = await import("../src/ui/analysis.ts");
const { LESSONS, HOME, REGISTER } = await import("../src/coach/lessons.ts");
const { renderTake } = await import("../src/analyze/demo.ts");
const { summarize } = await import("../src/coach/compare.ts");

const args = process.argv.slice(2);
const bodyName = args[0] === "female" ? "female" : "male";
const only = args.filter((a) => a !== "male" && a !== "female");
const body = bodyName === "female" ? { female: 1, child: 0 } : { female: 0, child: 0 };
const fs = 48000;
const cb = await buildCodebook(body);
const vm = new VoiceModel(body, fs);

const rows: Record<string, string | number>[] = [];
for (const l of LESSONS) {
  if (only.length && !only.includes(l.id)) continue;
  for (const t of l.takes) {
    const v = new OfflineVoice(fs, body);
    const note = HOME[bodyName] + REGISTER[l.register] + (t.semis ?? 0);
    const x = renderTake(v, vm, l, t, note);
    v.free();
    const s = summarize(analyze(x, fs, cb));
    rows.push(
      s
        ? { lesson: l.id, take: t.id, kind: t.kind, vowel: s.vowel, drive: +s.press.toFixed(2), ring: +s.ring.toFixed(2), air: +s.breath.toFixed(2), grit: +s.grit.toFixed(2), vibrato: s.vibShare > 0.3 ? `${s.vibRate.toFixed(1)}/s ±${Math.round(s.vibExtent)}c` : "-" }
        : { lesson: l.id, take: t.id, kind: t.kind, vowel: "(nothing sung)" },
    );
  }
}
console.table(rows);
