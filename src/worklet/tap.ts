/**
 * Microphone tap: the audio thread hands the microphone's samples to the page, 50 ms at a time
 * (Coach analyses the singer's own voice). It makes no sound.
 */
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}

class MicTap extends AudioWorkletProcessor {
  private readonly buf = new Float32Array(2400);
  private n = 0;

  process(inputs: Float32Array[][]): boolean {
    const chans = inputs[0];
    if (!chans || !chans.length) return true;
    const len = chans[0].length;
    for (let i = 0; i < len; i++) {
      let s = 0;
      for (const c of chans) s += c[i];
      this.buf[this.n++] = s / chans.length;
      if (this.n === this.buf.length) {
        this.port.postMessage(this.buf.slice());
        this.n = 0;
      }
    }
    return true;
  }
}

registerProcessor("mic-tap", MicTap);

export {};
