/** The one analysis worker (it keeps the codebooks), shared by Analyze and Coach's microphone. */
import type { FromWorker, ToWorker } from "./worker.ts";
import AnalyzeWorker from "./worker.ts?worker";

let worker: Worker | null = null;
let serial = 0;

/** A fresh request id. */
export const nextId = (): number => ++serial;

type Done = Extract<FromWorker, { type: "done" }>;
/** a request without its id (the client numbers it), keeping each kind's own fields */
export type Request = ToWorker extends infer M ? (M extends { id: number } ? Omit<M, "id"> & { id?: number } : never) : never;

/** Send a request and wait for its result; `progress` hears the stages on the way. */
export function askWorker<T extends FromWorker["type"] = "done">(m: Request, transfer: Transferable[] = [], progress?: (stage: string, fraction: number) => void): Promise<Extract<FromWorker, { type: T }>> {
  worker ??= new AnalyzeWorker();
  const w = worker;
  const id = m.id ?? nextId();
  return new Promise((resolve, reject) => {
    const on = (e: MessageEvent<FromWorker>) => {
      const r = e.data;
      if (r.id !== id) return;
      if (r.type === "progress") {
        progress?.(r.stage, r.fraction);
        return;
      }
      w.removeEventListener("message", on);
      if (r.type === "error") reject(new Error(r.message));
      else resolve(r as Extract<FromWorker, { type: T }>);
    };
    w.addEventListener("message", on);
    w.postMessage({ ...m, id }, transfer);
  });
}

export type { Done };
