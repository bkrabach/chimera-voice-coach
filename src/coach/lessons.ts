/**
 * The lessons. Each says what is physically happening, how to find it in your own body, and
 * sings it a few ways so the difference can be seen and heard.
 *
 * The numbers are postures and source settings of the engine (see `Shape`, `VoiceSource`). They
 * were chosen by rendering each take offline and measuring it (tools/coach-probe.ts): a take
 * that claims more ring has more energy at 2.4-3.6 kHz, a breathy one a steeper spectrum, and
 * so on. The wording follows voice science rather than one teaching school.
 */
import type { VoiceSource } from "../wasm/types.ts";
import type { Lesson, PatternId, Register, Shape, Step } from "./types.ts";

type Src = Partial<VoiceSource>;

/** Every take starts from this voice; a take's own settings go on top. */
export const BASE_SOURCE: Src = { glide: 0.05, pressure: 8.5, breathiness: 0.12, tension: 0.5, fry: 0, roughness: 0.1, vibratoDepth: 0, vibratoRate: 5.8, drift: 5, voiced: true, brightness: 0.3, distortion: 0 };

/** Voice qualities used by several lessons. */
export const Q = {
  /** folds meeting cleanly, steady breath */
  flow: { pressure: 8.5, breathiness: 0.12, tension: 0.5, brightness: 0.3 },
  /** folds never quite meeting */
  breathy: { pressure: 7, breathiness: 0.85, tension: 0.15, brightness: 0.1 },
  /** folds clamped, breath forced past them */
  pressed: { pressure: 14, breathiness: 0, tension: 0.95, brightness: 0.6 },
  /** thick folds, long closed phase */
  chest: { pressure: 11, breathiness: 0.05, tension: 0.72, brightness: 0.4 },
  /** full chest weight carried too high */
  pulled: { pressure: 16, breathiness: 0.02, tension: 0.92, brightness: 0.55, roughness: 0.28 },
  /** thin edges that do not close */
  falsetto: { pressure: 6.5, breathiness: 0.5, tension: 0.05, brightness: 0 },
  /** thin folds that close */
  head: { pressure: 8, breathiness: 0.15, tension: 0.22, brightness: 0.2 },
  /** thin-ish folds, firm closure */
  mix: { pressure: 10.5, breathiness: 0.07, tension: 0.55, brightness: 0.55 },
} satisfies Record<string, Src>;

/** the twang posture: the funnel above the folds narrowed, the larynx a little high */
const TWANG: Shape = { add: { larynx: 0.4 }, set: { epilarynx: 0.9 } };

/** The voice's home note (MIDI): a comfortable low-middle note for each body. */
export const HOME = { male: 52, female: 57, child: 62 } as const;

export const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Semitones above the voice's home note for each part of the range. */
export const REGISTER: Record<Register, number> = { low: -5, mid: 3, high: 12, top: 15 };

/** A pattern's notes, as steps (semitones from the take's note) and its length in seconds. */
export function patternSteps(p: PatternId): { steps: Step[]; length: number } {
  switch (p) {
    case "hold":
      return { steps: [{ at: 0, semis: 0, glide: 0.02 }], length: 2.6 };
    case "scale": {
      const notes = [0, 2, 4, 5, 7, 5, 4, 2, 0];
      const d = 0.34;
      return { steps: notes.map((n, i) => ({ at: i * d, semis: n, glide: i ? 0.035 : 0.02 })), length: notes.length * d + 0.5 };
    }
    case "climb": {
      const notes = [0, 4, 7, 12];
      const d = 0.5;
      return { steps: notes.map((n, i) => ({ at: i * d, semis: n, glide: i ? 0.04 : 0.02 })), length: notes.length * d + 1.3 };
    }
    case "siren":
      return { steps: [{ at: 0, semis: 0, glide: 0.02 }, { at: 0.35, semis: 12, glide: 0.5 }, { at: 2.1, semis: 0, glide: 0.5 }], length: 3.8 };
    case "leap":
      return { steps: [{ at: 0, semis: 0, glide: 0.02 }, { at: 0.8, semis: 12, glide: 0.05 }, { at: 2.2, semis: 0, glide: 0.06 }], length: 3.1 };
  }
}

export const LESSONS: Lesson[] = [
  // ------------------------------------------------------------------ foundation
  {
    id: "breath",
    group: "Foundation",
    title: "Breath support",
    tagline: "Steady pressure under the note, not more air",
    what: [
      "Your lungs are the bellows. Sound starts when air pressure under the closed vocal folds blows them apart, again and again. The pressure sets how loud you are; the amount of air escaping mostly sets how breathy you are.",
      "Support means holding that pressure steady: the ribs and belly come in slowly, instead of the chest collapsing and dumping air through the folds.",
    ],
    feel: [
      "Breathe low and wide: the lower ribs spread sideways, the belly lets go, the shoulders stay down.",
      "As you sing, keep the ribs wide for as long as you can, like letting a tyre down slowly. Firm and quiet, not a sigh.",
    ],
    practice: [
      "Hiss 'sss' for 15 seconds at one even loudness. Then sing one note with the same steady feeling under it.",
      "High notes need more pressure but less air than you expect. If you run out of breath on them, you are leaking, not under-breathing.",
    ],
    vowel: "ɑ",
    register: "mid",
    pattern: "hold",
    parts: ["breath", "folds"],
    takes: [
      {
        id: "collapse",
        label: "Collapsing",
        kind: "avoid",
        says: "Too little pressure, and it sags as the note goes on: quiet, airy, and the pitch wanders. Watch the lung pressure fall and the air streaming through.",
        source: { pressure: 5, breathiness: 0.42, tension: 0.3, drift: 30 },
        steps: [
          { at: 0.9, source: { pressure: 4.2 } },
          { at: 1.7, source: { pressure: 3.5 } },
        ],
      },
      { id: "steady", label: "Supported", kind: "aim", says: "Steady pressure, and the folds closing cleanly every cycle. The note is the same at the end as at the start.", source: Q.flow },
      {
        id: "push",
        label: "Pushing",
        kind: "avoid",
        says: "Blowing hard and squeezing the folds to hold it back. Loud, harsh, and tiring within minutes: more air is not more power.",
        source: { pressure: 20, breathiness: 0.3, tension: 0.9, brightness: 0.5, roughness: 0.32 },
      },
    ],
  },
  {
    id: "closure",
    group: "Foundation",
    title: "Cord closure",
    tagline: "Breathy, clean or pressed: how the folds meet",
    what: [
      "The vocal folds are two small folds of muscle and skin across the top of the windpipe. To sing a pitch they clap together hundreds of times a second: 220 times for the A below middle C.",
      "How firmly they meet, and how long they stay shut in each cycle, is the biggest tone control you have. Loose is breathy, firm is clear, clamped is pressed.",
    ],
    feel: [
      "Say 'uh-oh'. The catch in the middle is the folds closing. A sighed 'hhhaa' is the opposite: they never fully meet.",
      "Clean sits between the two: the note starts with no puff of air and no click.",
    ],
    practice: [
      "Sing 'ah' three ways: sighed, clean, squeezed. Then find the clean one again, coming from each side.",
      "The Vocal folds screen shows them from above, slowed down. Watch how wide they open and how long they stay shut.",
    ],
    vowel: "ɑ",
    register: "mid",
    pattern: "hold",
    parts: ["folds"],
    takes: [
      { id: "breathy", label: "Breathy", kind: "compare", says: "The folds never quite meet, so air hisses through all the time. Soft and intimate as a colour; as a habit it runs you out of breath and dries the folds.", source: Q.breathy },
      { id: "clean", label: "Clean", kind: "aim", says: "They meet fully and briefly each cycle. Clear, efficient, and the starting point for everything else.", source: Q.flow },
      { id: "pressed", label: "Pressed", kind: "avoid", says: "Clamped shut for most of each cycle, with the breath forced past. Edgy and loud for a moment, but it is the fast road to a tired voice.", source: Q.pressed },
    ],
  },
  {
    id: "registers",
    group: "Foundation",
    title: "Chest, head and mix",
    tagline: "The same high note, four ways",
    what: [
      "On low notes the folds are short and thick and meet through their whole depth: chest voice, strong and buzzy. On high notes they are stretched long and thin and only the edges touch: head voice, or falsetto when it is airy.",
      "Mix is not a third mechanism. It is thinner folds that still close firmly, plus twang, so a high note keeps the punch of chest without the full weight being dragged up.",
    ],
    feel: [
      "Chest: a buzz in the breastbone. Head: the buzz moves up behind the eyes and the throat feels as if it lets go.",
      "Mix: the firmness of calling 'hey!' across a room, at head-voice pitch, without the weight of a yell.",
    ],
    practice: [
      "Slide on 'ng' from your lowest note to your highest and back. Let it flip; do not fight it.",
      "Then a bratty 'nay-nay-nay' up through the same notes. The twang lets the folds stay together without the weight.",
    ],
    vowel: "ɑ",
    register: "high",
    pattern: "hold",
    parts: ["folds", "twang"],
    takes: [
      { id: "pulled", label: "Pulled chest", kind: "avoid", says: "Full chest weight dragged up high: loud and shouty, with the larynx riding up. This is the note that cracks.", source: Q.pulled, shape: { add: { larynx: 0.9 } }, parts: ["folds", "larynx"], zones: ["throat"] },
      { id: "falsetto", label: "Falsetto", kind: "compare", says: "Thin edges that do not fully close: light and airy, with little power. Look how briefly the folds touch, if at all.", source: Q.falsetto, zones: ["head"] },
      { id: "head", label: "Head voice", kind: "compare", says: "Thin folds that do close: clear and flute-like. Most of the sound is the fundamental.", source: Q.head, zones: ["head"] },
      { id: "mix", label: "Mix", kind: "aim", says: "Firm closure on thinner folds, with twang adding the bite. It reads as chest to a listener, at a fraction of the effort.", source: Q.mix, shape: TWANG, zones: ["mask"] },
      {
        id: "siren",
        label: "Through the break",
        kind: "compare",
        says: "One slide from chest up into head and back. You can hear the gear change; smoothing it is what mix training is for.",
        semis: -12,
        pattern: "siren",
        source: Q.chest,
        steps: [
          { at: 0.75, source: Q.head },
          { at: 2.45, source: Q.chest },
        ],
      },
    ],
  },
  // ------------------------------------------------------------------ tone
  {
    id: "twang",
    group: "Tone",
    title: "Twang",
    tagline: "The ring that cuts through a band",
    what: [
      "Just above the vocal folds is a short funnel, the epilarynx. Narrowing it (the feeling of a cackle or a duck's quack) makes the throat boost the band around 3 kHz, exactly where hearing is most sensitive.",
      "That band is what carries over guitars and drums. It adds loudness without more breath or more squeeze at the folds, which makes it the rock singer's main power tool.",
    ],
    feel: [
      "Cackle like a witch, quack like a duck, or taunt 'nyeah-nyeah'. That bright, pointed edge is twang.",
      "The narrowing is low in the throat, just above the folds. The neck stays loose and the nose is optional: pinch your nose and the ring should stay.",
    ],
    practice: [
      "'Nyae-nyae-nyae' on five notes, as bratty as you can. Then keep the ring and relax the brat into 'yeah'.",
      "Watch the Spectrum screen: the RING box (2.4 to 3.6 kHz) fills in when twang is on.",
    ],
    vowel: "ɛ",
    register: "mid",
    pattern: "hold",
    parts: ["twang", "larynx"],
    takes: [
      { id: "plain", label: "No twang", kind: "compare", says: "A wide funnel: warm and round, and it disappears behind a band.", source: { brightness: 0.12 }, shape: { set: { epilarynx: 0 } }, zones: ["throat"] },
      { id: "twang", label: "Twang", kind: "aim", says: "The funnel narrowed. Same note, same breath, but the 3 kHz band lights up and the voice comes forward.", source: { brightness: 0.62, breathiness: 0.06 }, shape: TWANG, zones: ["mask"] },
      {
        id: "nasal",
        label: "Nasal twang",
        kind: "compare",
        says: "Twang with the soft palate lowered as well: the country or 'bratty' colour. Useful as a choice, but twang does not need the nose.",
        source: { brightness: 0.62, breathiness: 0.06 },
        shape: { add: { larynx: 0.4 }, set: { epilarynx: 0.9, velum: 0.45 } },
        parts: ["twang", "softPalate", "nose"],
        zones: ["mask"],
      },
    ],
  },
  {
    id: "larynx",
    group: "Tone",
    title: "Larynx height",
    tagline: "Dark to bright by the length of the tube",
    what: [
      "The larynx (voice box) hangs in the neck and can ride up or down by about a centimetre. That changes the length of the tube above it: longer is darker, shorter is brighter.",
      "Low gives the yawny, operatic colour. High gives a thinner, more urgent one. Rock lives mostly at neutral to slightly high; the fault is letting it shoot up and squeeze as the pitch rises.",
    ],
    feel: [
      "Rest a finger on your Adam's apple. Swallow, and it jumps up. Begin a yawn, and it drops.",
      "Slide up in pitch and notice whether it climbs with you. A little is normal. A lot, with a tight neck, is the squeeze to unlearn.",
    ],
    practice: ["Sing a dopey 'buh-buh-buh' on a scale to feel a lower, steady larynx. Then go back to speaking height and keep the steadiness."],
    vowel: "ɑ",
    register: "mid",
    pattern: "hold",
    parts: ["larynx", "throat"],
    takes: [
      { id: "low", label: "Low", kind: "compare", says: "Dropped as in a yawn: a longer tube, every resonance lower, a dark and hooty colour.", shape: { add: { larynx: -1.2 } }, source: { brightness: 0.2 } },
      { id: "neutral", label: "Neutral", kind: "aim", says: "Speaking height: the home base. Watch the F1 to F3 numbers move as it rises and falls.", shape: {} },
      { id: "high", label: "High", kind: "compare", says: "Raised as in a swallow: a shorter tube, every resonance higher, a thin and bright colour. On top notes this is where squeeze begins.", shape: { add: { larynx: 1.0 } }, source: { brightness: 0.4 } },
    ],
  },
  {
    id: "palate",
    group: "Tone",
    title: "Soft palate",
    tagline: "The door between mouth and nose",
    what: [
      "The soft palate is the door between your mouth and your nose. Lifted, it seals the nose off and all the sound leaves through the mouth. Lowered, part of the sound detours through the nose, which soaks up energy and dulls the vowel.",
    ],
    feel: [
      "Start a yawn, or get ready to gasp in surprise. The lift at the back of the roof of your mouth is the palate rising.",
      "Test: sing 'ah' and pinch your nose. If the sound changes, the door is open.",
    ],
    practice: ["Alternate 'ng-ah, ng-ah' slowly. Feel the back of the tongue and the palate part as the 'ah' opens."],
    vowel: "ɑ",
    register: "mid",
    pattern: "hold",
    parts: ["softPalate", "nose"],
    takes: [
      { id: "up", label: "Palate up", kind: "aim", says: "The door shut: all the sound comes out of the mouth. Clear vowel, full level.", shape: { set: { velum: -0.15 } }, zones: ["mouth"] },
      { id: "nasal", label: "Nasal", kind: "avoid", says: "The door half open: the vowel turns honky and loses level as sound leaks into the nose. See the airflow split.", shape: { set: { velum: 0.6 } }, zones: ["mask"] },
      { id: "hum", label: "Hum", kind: "compare", says: "Lips shut, palate down: everything goes through the nose. A good warm-up, and the way to find the buzz at the bridge of the nose.", shape: { set: { velum: 0.9, lipAp: -0.25 } }, parts: ["softPalate", "nose", "lips"], zones: ["mask"] },
    ],
  },
  {
    id: "vowels",
    group: "Tone",
    title: "Vowel shapes",
    tagline: "A vowel is a shape of the tongue, jaw and lips",
    what: [
      "A vowel is a shape, not something you add to the sound. The tongue, jaw and lips reshape the tube, which moves its resonances (formants). The two lowest decide which vowel you hear.",
      "Tongue height and jaw set the first one (F1: low for EE and OO, high for AH). The tongue sliding forward or back sets the second (F2: high for EE, low for OO).",
    ],
    feel: [
      "Say EE-EH-AH slowly: the jaw drops and the tongue lowers. Say EE-OO: the tongue slides back and the lips round.",
      "The tip of the tongue can rest behind the lower teeth for all of them. Only the body of the tongue travels.",
    ],
    practice: ["Sing one note through EE-EH-AH-OH-OO. The pitch and the loudness stay; only the shape moves."],
    vowel: "ɑ",
    register: "mid",
    pattern: "hold",
    parts: ["tongue", "jaw", "lips"],
    takes: [
      { id: "ee", label: "EE", kind: "compare", says: "Tongue high and forward, almost touching the hard palate; lips spread. F1 low, F2 high.", shape: { vowel: "i" } },
      { id: "eh", label: "EH", kind: "compare", says: "Tongue still forward but lower, jaw half open.", shape: { vowel: "ɛ" } },
      { id: "ah", label: "AH", kind: "compare", says: "Jaw open, tongue low and a little back. F1 at its highest: the loudest, most open vowel.", shape: { vowel: "ɑ" } },
      { id: "oh", label: "OH", kind: "compare", says: "Tongue back, lips rounding. Both resonances come down.", shape: { vowel: "o" } },
      { id: "oo", label: "OO", kind: "compare", says: "Tongue high at the back, lips small and forward. The darkest, most closed vowel.", shape: { vowel: "u" } },
    ],
  },
  {
    id: "modify",
    group: "Tone",
    title: "Vowels on high notes",
    tagline: "Reshape the vowel as you climb",
    what: [
      "A sung note is a stack of harmonics, and the tube only amplifies the ones near its resonances. As the pitch rises the harmonics spread apart, so a shape that worked low down can leave the strong harmonics with nothing to ring in.",
      "So singers reshape the vowel on the way up. Belting opens the mouth to lift the first resonance and keep it over the second harmonic: bright and speech-like. The classical way lets it slip under and rounds the vowel: darker, 'covered'.",
    ],
    feel: [
      "Belt: think of the vowel getting taller as you climb. 'Ah' drifts toward the 'a' of 'cat' as the jaw drops; 'ee' opens toward 'ih'.",
      "Cover: 'ah' drifts toward 'uh'. The throat feels as if it opens and the sound turns over.",
    ],
    practice: [
      "Sing 1-3-5-8 on 'ah'. First change nothing. Then let the jaw drop a finger's width more on each step. Then try rounding toward 'uh' on the top note.",
      "On the Spectrum screen the thin stems are your harmonics and the curve is the tube's resonance. Loud notes have a stem under a peak.",
    ],
    vowel: "ɑ",
    register: "mid",
    pattern: "climb",
    parts: ["jaw", "tongue", "larynx"],
    takes: [
      { id: "fixed", label: "Same shape", kind: "avoid", says: "The low-note 'ah' held rigid to the top. The harmonics climb away from the resonance peaks and the top note thins out or strains.", source: Q.chest },
      {
        id: "open",
        label: "Open it (belt)",
        kind: "aim",
        says: "The jaw drops and the vowel leans toward 'a' as in 'cat' on the way up, with twang. The first resonance follows the second harmonic, so the top note stays loud and bright.",
        source: Q.chest,
        steps: [
          { at: 0.5, shape: { toward: ["æ", 0.3], add: { larynx: 0.2 }, set: { epilarynx: 0.4 } } },
          { at: 1.0, shape: { toward: ["æ", 0.6], add: { larynx: 0.4 }, set: { epilarynx: 0.7 } } },
          { at: 1.5, shape: { toward: ["æ", 0.9], add: { larynx: 0.6, jaw: 0.3, lipAp: 0.3 }, set: { epilarynx: 0.9 } }, source: Q.mix },
        ],
      },
      {
        id: "cover",
        label: "Round it (cover)",
        kind: "compare",
        says: "The vowel leans toward 'uh' and the larynx stays low. The first resonance drops under the second harmonic: a rounder, darker top note with less shout.",
        source: Q.chest,
        steps: [
          { at: 1.0, shape: { toward: ["ʌ", 0.5], add: { larynx: -0.3 } } },
          { at: 1.5, shape: { toward: ["ʌ", 0.95], add: { larynx: -0.5 } }, source: Q.head },
        ],
      },
    ],
  },
  {
    id: "placement",
    group: "Tone",
    title: "Placement",
    tagline: "Forward or back is a feeling made by a shape",
    what: [
      "You cannot aim sound: it leaves through the mouth whatever you imagine. 'Placement' is where you feel vibration, and that follows from the shape you make.",
      "Bright shapes (twang, tongue forward, larynx not pulled down) put energy into the high harmonics, which you feel as buzz in the hard palate, teeth and bridge of the nose: 'forward', 'in the mask'. A pulled-back tongue and dropped larynx keep the energy low: 'back', 'in the throat'.",
    ],
    feel: [
      "Hum 'mmm' or 'ng' until the lips or the bridge of the nose tingle. Open to 'mee-meh-mah' and keep the tingle.",
      "Forward is not nasal. Pinch your nose on the open vowel: the tone should not change.",
    ],
    practice: ["Speak 'yeah' as a bored teenager, then as a cartoon villain. Sing a phrase each way, then settle between them, leaning forward."],
    vowel: "ɛ",
    register: "mid",
    pattern: "scale",
    parts: ["twang", "tongueRoot", "softPalate"],
    takes: [
      { id: "back", label: "Back", kind: "avoid", says: "Tongue root pulled back, larynx pressed down, no twang. Muffled and swallowed; it feels big inside your head and sounds small outside it.", source: { brightness: 0.05 }, shape: { add: { root: -0.8, larynx: -1.0, tbX: -0.25 }, set: { epilarynx: 0 } }, parts: ["tongueRoot", "larynx"], zones: ["throat"] },
      { id: "forward", label: "Forward", kind: "aim", says: "Tongue released forward, twang on, palate up. The energy moves up into the 3 kHz band and you feel it behind the nose and teeth.", source: { brightness: 0.58, breathiness: 0.06 }, shape: { add: { root: 0.3, larynx: 0.3 }, set: { epilarynx: 0.85 } }, parts: ["twang", "tongueRoot", "softPalate"], zones: ["mask"] },
      { id: "nose", label: "In the nose", kind: "avoid", says: "Chasing 'forward' by opening the nose instead. It buzzes in the mask too, but the tone turns honky and loses level.", source: { brightness: 0.3 }, shape: { set: { velum: 0.6, epilarynx: 0.2 } }, parts: ["softPalate", "nose"], zones: ["mask"] },
    ],
  },
  {
    id: "tongue",
    group: "Tone",
    title: "Tongue root",
    tagline: "The front wall of your throat",
    what: [
      "The back of the tongue is the front wall of the throat. When it bunches back and down it squeezes the throat space and leans on the larynx: the muffled, 'swallowed' sound, and a common cause of strain on high notes.",
    ],
    feel: [
      "Press a thumb gently up under your chin, behind the bone, and sing. It should stay soft. If it pushes down against the thumb, the tongue root is working when it should not.",
      "Let the tip rest against the back of the lower front teeth, and let the tongue be wide.",
    ],
    practice: ["Sing a scale on 'yah-yah-yah', or with the tongue resting out over the lower lip. Both stop the root pulling back. Then sing the phrase normally and keep the feeling."],
    vowel: "ɑ",
    register: "mid",
    pattern: "scale",
    parts: ["tongueRoot", "tongue", "throat"],
    takes: [
      { id: "pulled", label: "Pulled back", kind: "avoid", says: "The root bunched back and down. The throat space narrows and the tone goes dull and thick.", source: { brightness: 0.12 }, shape: { add: { root: -0.9, larynx: -0.6, tbX: -0.3 } }, zones: ["throat"] },
      { id: "free", label: "Released", kind: "aim", says: "The root let forward and the tongue wide. The throat opens behind it and the vowel clears.", shape: { add: { root: 0.3 } }, zones: ["mouth"] },
    ],
  },
  // ------------------------------------------------------------------ rock tools
  {
    id: "belt",
    group: "Rock tools",
    title: "Belt",
    tagline: "High and powerful without yelling",
    what: [
      "A belt is a high note that sounds like chest voice. The folds close firmly but are not at full chest thickness, and the throat and mouth make a megaphone: narrow just above the folds (twang), wide at the lips, larynx a little high.",
      "The megaphone lifts the first resonance onto the second harmonic. That one lined-up harmonic is most of the 'power'. It takes firm closure and steady pressure, but very little air.",
    ],
    feel: [
      "Call 'HEY!' to a friend across the street. That is the coordination. Now hold the vowel.",
      "Mouth tall, as if biting an apple; ribs wide. The sound rings in the hard palate, not in the throat.",
    ],
    practice: ["'Hey!' then 'heeey' on one note, then walk it up by half steps. Stop at the first note where the neck tightens: that is today's ceiling."],
    care: "A belt that hurts, scratches, or needs a run-up of air is a yell. Come down in volume and add twang instead.",
    vowel: "ɛ",
    register: "top",
    pattern: "hold",
    parts: ["twang", "larynx", "jaw", "folds"],
    takes: [
      { id: "yell", label: "Yell", kind: "avoid", says: "Full chest weight and breath pressure with a wide, untwanged throat and the tongue pulling back. Loud for now, and it will not last a set.", source: Q.pulled, shape: { add: { larynx: 1.0, root: -0.4 }, set: { epilarynx: 0.05 } }, parts: ["folds", "larynx", "tongueRoot", "breath"], zones: ["throat"] },
      { id: "belt", label: "Belt", kind: "aim", says: "Twang on, mouth tall, firm but not clamped folds, moderate pressure. Compare the lung pressure with the yell: lower, yet the note carries further.", source: { ...Q.mix, tension: 0.62, pressure: 12 }, shape: { toward: ["æ", 0.5], add: { larynx: 0.5, jaw: 0.25, lipAp: 0.3 }, set: { epilarynx: 0.9 } }, zones: ["mask"] },
      { id: "flip", label: "Flip", kind: "compare", says: "Letting go into falsetto on the same note. Safe, but it is a different colour: light, with the punch gone.", source: Q.falsetto, parts: ["folds"], zones: ["head"] },
    ],
  },
  {
    id: "grit",
    group: "Rock tools",
    title: "Grit and rasp",
    tagline: "Noise made above the folds, over a clean note",
    what: [
      "Healthy rasp is made above the vocal folds. The false folds (a second pair, just above the true ones) and the rim of the larynx are brought close enough to flutter in the airstream, adding a rattle on top of a note the true folds are still singing cleanly.",
      "So grit is an add-on to a good clean tone: twang on, steady support, moderate volume. The microphone does the loudness.",
    ],
    feel: [
      "The sound of relish, 'ahhh' after a cold drink, or a soft purring rumble held on a note at low volume. A vibration above the note, never a scrape.",
      "The breath stays calm. If you need to push air to get the rattle, it is coming from the wrong place.",
    ],
    practice: ["Sing a clean, twangy 'yeah' quietly. Add the smallest rattle for a second, then take it off again: same note, same volume. On, off, on, off. If you cannot take it off, you are grinding."],
    care: "Stop if it hurts, tickles, makes you cough, or leaves you hoarse afterwards. Build it in short sets, well hydrated, ideally with a teacher who works with distortion. The synthesizer imitates the rattle by making the fold cycles irregular: use it for the idea and the sound, not as a model of your throat.",
    vowel: "ɛ",
    register: "high",
    pattern: "hold",
    parts: ["falseFolds", "twang", "folds"],
    takes: [
      { id: "clean", label: "Clean", kind: "compare", says: "The note underneath: twangy, supported, moderate. Everything else is added to this.", source: Q.mix, shape: TWANG, parts: ["twang", "folds"], zones: ["mask"] },
      { id: "edge", label: "Edge", kind: "aim", says: "The false folds drawn in until they just flutter. A light rattle over the same clean note, at the same breath pressure.", source: { ...Q.mix, distortion: 0.36 }, shape: { add: { larynx: 0.4 }, set: { epilarynx: 0.9, ventricular: 0.6 } }, zones: ["mask"] },
      { id: "rasp", label: "Full rasp", kind: "aim", says: "More of the same, not more air. The note is still there under the noise: you can hear its pitch.", source: { ...Q.mix, distortion: 0.56, pressure: 11.5 }, shape: { add: { larynx: 0.45 }, set: { epilarynx: 0.9, ventricular: 0.85 } }, zones: ["mask"] },
      { id: "grind", label: "Throat grind", kind: "avoid", says: "Rasp forced at the true folds: clamped shut, high pressure, no twang. The pitch dissolves into noise. This is the version that costs you your voice.", source: { ...Q.pressed, pressure: 19, distortion: 0.82, roughness: 0.6 }, shape: { add: { larynx: 1.1, root: -0.4 }, set: { epilarynx: 0.05 } }, parts: ["folds", "breath", "larynx"], zones: ["throat"] },
    ],
  },
  {
    id: "vibrato",
    group: "Rock tools",
    title: "Vibrato",
    tagline: "Straight tone, vibrato, and when to use each",
    what: [
      "Vibrato is the pitch swinging gently above and below the note five or six times a second. It appears by itself when the folds are balanced and the breath is steady: a sign of freedom, not something you shake into place.",
      "Rock uses it as punctuation: a straight, driving note that relaxes into vibrato at the end.",
    ],
    feel: [
      "Hold a comfortable note with steady support and let go of the jaw, tongue and neck. Do not hold the pitch still: the swing starts when nothing is gripping.",
      "It should not come from the jaw, the tongue or pumping the belly.",
    ],
    practice: ["Hold a note straight for two counts, then release into vibrato for two. Then reverse it. Being able to switch it on and off is the skill."],
    vowel: "ɑ",
    register: "mid",
    pattern: "hold",
    parts: ["folds", "larynx", "breath"],
    takes: [
      { id: "straight", label: "Straight", kind: "compare", says: "No swing at all. Direct and urgent; held too hard, it is also a sign of gripping.", source: { vibratoDepth: 0, drift: 3 } },
      { id: "even", label: "Vibrato", kind: "aim", says: "About 6 per second, a third of a semitone each way. The pitch you hear is the middle of the swing.", source: { vibratoDepth: 36, vibratoRate: 5.8 } },
      {
        id: "late",
        label: "Straight, then vibrato",
        kind: "aim",
        says: "The rock ending: the note drives straight, then lets go into vibrato for the last second.",
        source: { vibratoDepth: 0, drift: 3 },
        steps: [
          { at: 1.3, source: { vibratoDepth: 18 } },
          { at: 1.6, source: { vibratoDepth: 42 } },
        ],
      },
      { id: "wobble", label: "Wobble", kind: "avoid", says: "Too slow and too wide: it sounds unsteady and the pitch is hard to hear. Usually too much weight and pressure.", source: { vibratoDepth: 95, vibratoRate: 4.1, pressure: 12, tension: 0.7 } },
      { id: "tremolo", label: "Flutter", kind: "avoid", says: "Too fast and too narrow: a nervous bleat. Usually tension in the throat or jaw.", source: { vibratoDepth: 20, vibratoRate: 7.9, tension: 0.7 } },
    ],
  },
];

export const lessonById = (id: string): Lesson => LESSONS.find((l) => l.id === id) ?? LESSONS[0];
