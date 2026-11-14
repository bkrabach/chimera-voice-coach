/**
 * The human voice offline, for tools and tests: the wasm build (`bun run wasm`) loaded from disk
 * into src/analyze/render.ts's EngineVoice.
 */
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { EngineVoice } from "../../src/analyze/render.ts";
import type { BodyMix } from "../../src/wasm/types.ts";

export { concat, SOURCE_KEYS } from "../../src/analyze/render.ts";

const WASM_PATH = fileURLToPath(new URL("../../src/wasm/chimera.wasm", import.meta.url));
let module: WebAssembly.Module | null = null;

export class OfflineVoice extends EngineVoice {
  constructor(fs = 48000, body: BodyMix = { female: 0, child: 0 }) {
    module ??= new WebAssembly.Module(readFileSync(WASM_PATH));
    super(module, fs, body);
  }
}
