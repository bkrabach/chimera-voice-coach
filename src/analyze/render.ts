/**
 * The engine's human voice rendered offline, faster than real time: one engine instance driven
 * the way the AudioWorklet drives it (posture, source, breath, render). Used by Analyze's demo
 * (in its worker) and by the tools (tools/lib/voice.ts).
 */
import { CONTROL_KEYS } from "../wasm/wire.ts";
import type { BodyMix, HumanArtic, VoiceSource } from "../wasm/types.ts";

/** Source values in the engine's order (crates/chimera-wasm engine_set_source). */
export const SOURCE_KEYS = ["f0", "glide", "pressure", "breathiness", "tension", "fry", "roughness", "vibratoDepth", "vibratoRate", "drift", "voiced", "brightness", "distortion"] as const;

type Fn = (...a: number[]) => number;
type Exports = { memory: WebAssembly.Memory } & Record<string, Fn>;

export class EngineVoice {
  private readonly x: Exports;
  private readonly h: number;
  constructor(
    module: WebAssembly.Module,
    readonly fs = 48000,
    body: BodyMix = { female: 0, child: 0 },
  ) {
    this.x = new WebAssembly.Instance(module, {}).exports as unknown as Exports;
    this.h = this.x.engine_new(fs);
    if (body.female || body.child) this.x.engine_set_body(this.h, body.female, body.child);
  }
  private values(): Float64Array {
    return new Float64Array(this.x.memory.buffer, this.x.engine_values(this.h), 32).fill(NaN);
  }
  setArtic(values: Partial<HumanArtic>, tipFree?: boolean): void {
    const v = this.values();
    for (const [k, val] of Object.entries(values)) {
      const i = CONTROL_KEYS.indexOf(k as never);
      if (i >= 0 && typeof val === "number") v[i] = val;
    }
    this.x.engine_set_artic(this.h, tipFree === undefined ? 2 : tipFree ? 1 : 0);
  }
  setSource(values: Partial<VoiceSource>): void {
    const v = this.values();
    for (const [k, val] of Object.entries(values)) {
      const i = SOURCE_KEYS.indexOf(k as never);
      if (i >= 0) v[i] = typeof val === "boolean" ? (val ? 1 : 0) : (val as number);
    }
    this.x.engine_set_source(this.h);
  }
  gate(level: number): void {
    this.x.engine_set_gate(this.h, level);
  }
  /** Render `seconds` of sound. */
  render(seconds: number): Float32Array {
    const n = Math.round(seconds * this.fs);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i += 128) {
      const m = Math.min(128, n - i);
      out.set(new Float32Array(this.x.memory.buffer, this.x.engine_render(this.h, m), m), i);
    }
    return out;
  }
  free(): void {
    this.x.engine_free(this.h);
  }
}

/** Join rendered pieces. */
export function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
