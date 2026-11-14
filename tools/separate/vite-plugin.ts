/**
 * The dev server's vocal isolator: POST a full track to /api/separate and get the vocal back as
 * a WAV. It runs tools/separate/separate.py (Demucs) in the Python environment `bun run
 * setup:separate` makes; GET /api/separate says whether that environment is there. Nothing here
 * exists in a static build: Analyze then takes vocals only.
 */
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const HERE = fileURLToPath(new URL(".", import.meta.url));
/** overridable, for tests: another interpreter and another script with the same arguments */
const PYTHON = process.env.CHIMERA_SEPARATE_PYTHON ?? join(HERE, ".venv/bin/python");
const SCRIPT = process.env.CHIMERA_SEPARATE_SCRIPT ?? join(HERE, "separate.py");
const MAX_BYTES = 400 * 1024 * 1024;
const MAX_MS = 40 * 60 * 1000;

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};

/** one song at a time: the model fills the machine */
let busy = false;

function separate(req: IncomingMessage, res: ServerResponse): void {
  if (!existsSync(PYTHON)) return json(res, 503, { error: "vocal isolation is not set up: run `bun run setup:separate` once, then try again" });
  if (busy) return json(res, 429, { error: "another track is being split: wait for it to finish" });
  busy = true;
  const dir = mkdtempSync(join(tmpdir(), "chimera-separate-"));
  const done = () => {
    busy = false;
    rmSync(dir, { recursive: true, force: true });
  };
  let name = "track";
  try {
    name = decodeURIComponent(String(req.headers["x-filename"] ?? "track"));
  } catch {
    /* an odd header: the name only supplies the extension */
  }
  const ext = /^\.[a-z0-9]{1,5}$/i.test(extname(name)) ? extname(name) : ".bin";
  const src = join(dir, `in${ext}`), dst = join(dir, "vocals.wav");
  const file = createWriteStream(src);
  let bytes = 0, failed = false;
  req.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > MAX_BYTES && !failed) {
      failed = true;
      req.destroy();
      file.destroy();
      done();
      json(res, 413, { error: "the file is too large (400 MB at most)" });
    }
  });
  req.on("error", () => {
    if (!failed) {
      failed = true;
      file.destroy();
      done();
    }
  });
  req.pipe(file);
  file.on("finish", () => {
    if (failed) return;
    const child = spawn(PYTHON, [SCRIPT, src, dst], { env: { ...process.env, TORCH_HOME: process.env.TORCH_HOME ?? join(HERE, ".cache") } });
    let err = "";
    child.stderr.on("data", (d: Buffer) => (err = (err + d.toString()).slice(-2000)));
    const timer = setTimeout(() => child.kill(), MAX_MS);
    child.on("error", (e) => {
      clearTimeout(timer);
      done();
      json(res, 500, { error: `the isolator could not start: ${e.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || !existsSync(dst)) {
        done();
        const last = err.trim().split("\n").pop() ?? "";
        return json(res, 500, { error: `the vocal could not be isolated${last ? `: ${last}` : ""}` });
      }
      res.statusCode = 200;
      res.setHeader("content-type", "audio/wav");
      res.setHeader("content-length", String(statSync(dst).size));
      const out = createReadStream(dst);
      out.pipe(res);
      out.on("close", done);
    });
  });
}

function handle(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  if (!req.url || req.url.split("?")[0] !== "/api/separate") return next();
  if (req.method === "GET") return json(res, 200, { available: existsSync(PYTHON) });
  if (req.method === "POST") return separate(req, res);
  json(res, 405, { error: "GET or POST" });
}

export function separatePlugin(): Plugin {
  return {
    name: "chimera-separate",
    configureServer(server) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}
