/** What a frame of the analysis says, in a singer's words. */
import { KIND, type VoiceTrack } from "./analyze.ts";

const NOTE = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

/** How a singer would spell each vowel the analysis can match. */
export const VOWEL_WORD: Record<string, string> = { i: "EE", ɪ: "IH", e: "AY", ɛ: "EH", æ: "AA", a: "AH", ɑ: "AH", ɒ: "AW", ɔ: "AW", o: "OH", ʊ: "UU", u: "OO", ʌ: "UH", ə: "UH", ɐ: "UH", y: "UE", ø: "OE", œ: "OE", ɨ: "IH", ɯ: "UH", ɤ: "UH" };
export const vowelWord = (ipa: string | undefined) => (ipa ? (VOWEL_WORD[ipa] ?? ipa.toUpperCase()) : "");

export interface Reading {
  kind: "silence" | "voiced" | "noise" | "breath";
  /** the note's name and how far the pitch is from it (cents), while voiced */
  note: string;
  cents: number;
  hz: number;
  /** how the folds are closing, in a word or two */
  closure: string;
  /** everything notable about the sound now, most telling first */
  words: string[];
}

export function closureWord(press: number): string {
  if (press < 0.2) return "light, head-like";
  if (press < 0.42) return "easy";
  if (press < 0.68) return "firm";
  if (press < 0.88) return "heavy, chest-like";
  return "pressed";
}

export function read(t: VoiceTrack, i: number): Reading {
  const k = t.kind[i];
  if (k !== KIND.voiced || t.entry[i] < 0) {
    return { kind: k === KIND.breath ? "breath" : k === KIND.noise || k === KIND.voiced ? "noise" : "silence", note: "", cents: 0, hz: 0, closure: "", words: k === KIND.breath ? ["breath in"] : k === KIND.noise ? ["consonant or noise"] : [] };
  }
  const centre = t.note[i] > 0 ? t.note[i] : t.f0[i];
  const midi = 69 + 12 * Math.log2(centre / 440);
  const near = Math.round(midi);
  const closure = closureWord(t.press[i]);
  const words: string[] = [`${closure} closure`];
  if (t.grit[i] > 0.6) words.push("raspy");
  else if (t.grit[i] > 0.3) words.push("an edge of grit");
  if (t.ring[i] > 0.6) words.push("strong ring");
  else if (t.ring[i] > 0.35) words.push("some ring");
  else if (t.ring[i] < 0.08) words.push("dark");
  if (t.breath[i] > 0.5) words.push("airy");
  if (t.vibExtent[i] > 0) words.push(`vibrato ${t.vibRate[i].toFixed(1)}/s`);
  else words.push("straight");
  return { kind: "voiced", note: `${NOTE[((near % 12) + 12) % 12]}${Math.floor(near / 12) - 1}`, cents: Math.round((midi - near) * 100), hz: t.f0[i], closure, words };
}
