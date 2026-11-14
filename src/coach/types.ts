/**
 * Coach: lessons that show a piece of vocal technique on the head and sing it, so it can be seen
 * and copied. A lesson has a few "takes" (the same note sung different ways); each take is a
 * posture and a voice-source setting the engine sings.
 */
import type { HumanArtic, VoiceSource } from "../wasm/types.ts";

/** A part of the instrument a callout can point at. */
export type PartId = "breath" | "folds" | "falseFolds" | "twang" | "larynx" | "throat" | "softPalate" | "nose" | "tongue" | "tongueRoot" | "jaw" | "lips";

/** Where a singer feels the vibration (a sensation, not where the sound goes). */
export type ZoneId = "chest" | "throat" | "mouth" | "mask" | "head";

/** A posture: a calibrated vowel, optionally blended toward another, then nudged. */
export interface Shape {
  /** IPA vowel (a calibrated target of the body); the lesson's vowel when absent */
  vowel?: string;
  /** blend the vowel toward another one: [ipa, 0..1] */
  toward?: [string, number];
  /** offsets added to the vowel's articulation */
  add?: Partial<HumanArtic>;
  /** absolute values (after `add`) */
  set?: Partial<HumanArtic>;
}

/** Something that changes while a take is sung. */
export interface Step {
  /** seconds from the start of the take */
  at: number;
  /** pitch, in semitones from the take's note */
  semis?: number;
  /** how long the pitch takes to get there (s) */
  glide?: number;
  shape?: Shape;
  source?: Partial<VoiceSource>;
  /** a word shown at the mouth from here on */
  cue?: string;
}

export type PatternId = "hold" | "scale" | "siren" | "climb" | "leap";

export interface Take {
  id: string;
  /** on its button: two or three words */
  label: string;
  /** aim: what to copy. avoid: a common fault, shown so it can be recognised. compare: neither. */
  kind: "aim" | "avoid" | "compare";
  /** one or two sentences: what is happening, what to listen and look for */
  says: string;
  shape?: Shape;
  source?: Partial<VoiceSource>;
  /** pitch offset from the lesson's note (semitones) */
  semis?: number;
  pattern?: PatternId;
  /** extra changes over time, on top of the pattern */
  steps?: Step[];
  /** the parts this take lights (the lesson's when absent) */
  parts?: PartId[];
  zones?: ZoneId[];
}

export type Register = "low" | "mid" | "high" | "top";

export interface Lesson {
  id: string;
  group: "Foundation" | "Tone" | "Rock tools";
  title: string;
  /** under the title: what the lesson is for, in a line */
  tagline: string;
  /** what is physically happening */
  what: string[];
  /** how to find it in your own body */
  feel: string[];
  /** a short exercise */
  practice: string[];
  /** a caution, when one is due */
  care?: string;
  vowel: string;
  register: Register;
  pattern: PatternId;
  parts: PartId[];
  takes: Take[];
}
