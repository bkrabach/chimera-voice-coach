/**
 * The human voice offline, for tools and tests: one engine instance driven the way the
 * AudioWorklet drives it (set the posture and source, open the breath, render), faster than real
 * time. Needs the wasm build (`bun run wasm`).
 */
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { CONTROL_KEYS } from "../../src/wasm/wire.ts";
import type { BodyMix, HumanArtic, VoiceSource } from "../../src/wasm/types.ts";

const WASM_PATH = fileURLToPath(new URL("../../src/wasm/chimera.wasm", import.meta.url));
let module: WebAssembly.Module | null = null;

/** Source values in the engine's order (crates/chimera-wasm engine_set_source). */
export const SOURCE_KEYS = ["f0", "glide", "pressure", "breathiness", "tension", "fry", "roughness", "vibratoDepth", "vibratoRate", "drift", "voiced", "brightness", "distortion"] as const;

type Fn = (...a: number[]) => number;
type Exports = { memory: WebAssembly.Memory } & Record<string, Fn>;

export class OfflineVoice {
  private readonly x: Exports;
  private readonly h: number;
  constructor(readonly fs = 48000, body: BodyMix = { female: 0, child: 0 }) {
    module ??= new WebAssembly.Module(readFileSync(WASM_PATH));
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
