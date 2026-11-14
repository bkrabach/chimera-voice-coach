/**
 * Naming a sung vowel from its first two formants.
 *
 * The centres below are where trained singers put the five vowels they were asked for: the middle
 * (F1, F2) of each vowel over the 20 singers of VocalSet (Wilkins et al. 2018, CC BY 4.0), men and
 * women apart, as tools/eval/formant_report.py prints them. They are not speech vowels: a singer's
 * vowels sit darker (the second formant 12-18 % lower than in speech), which is why naming them
 * against speech shapes went wrong (44 % right) and against these goes right about three times in
 * four with the singer held out of the centres (docs/validation.md). AH/OH and OH/OO are the
 * neighbours that get confused: sung, they are close.
 */
export interface SungVowel {
  name: string;
  ipa: string;
  /** (F1, F2) in Hz: adult men, adult women */
  male: [number, number];
  female: [number, number];
}

export const SUNG_VOWELS: readonly SungVowel[] = [
  { name: "EE", ipa: "i", male: [343, 1885], female: [431, 2100] },
  { name: "EH", ipa: "e", male: [540, 1594], female: [567, 1830] },
  { name: "AH", ipa: "ɑ", male: [677, 1070], female: [722, 1276] },
  { name: "OH", ipa: "o", male: [553, 926], female: [585, 1065] },
  { name: "OO", ipa: "u", male: [429, 982], female: [463, 1098] },
];

/** the first formant's differences count for more, as they do to the ear */
const W1 = 1.6;
/** two vowels are "between" each other when their distances differ by less than this (in log Hz) */
const NEAR = 0.1;

/**
 * The sung vowel nearest (F1, F2) for a body between a man's (`female` 0) and a woman's (1), and
 * the next nearest when the point lies between the two (255 otherwise).
 */
export function nameVowel(F1: number, F2: number, female: number): { vowel: number; near: number } {
  if (!(F1 > 0 && F2 > 0)) return { vowel: 255, near: 255 };
  const l1 = Math.log(F1), l2 = Math.log(F2);
  let best = 255, second = 255, bd = Infinity, sd = Infinity;
  for (let k = 0; k < SUNG_VOWELS.length; k++) {
    const v = SUNG_VOWELS[k];
    const c1 = Math.log(v.male[0]) * (1 - female) + Math.log(v.female[0]) * female;
    const c2 = Math.log(v.male[1]) * (1 - female) + Math.log(v.female[1]) * female;
    const d = Math.hypot(W1 * (l1 - c1), l2 - c2);
    if (d < bd) {
      sd = bd;
      second = best;
      bd = d;
      best = k;
    } else if (d < sd) {
      sd = d;
      second = k;
    }
  }
  return { vowel: best, near: sd - bd < NEAR ? second : 255 };
}
