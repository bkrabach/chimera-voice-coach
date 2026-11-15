import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { separatePlugin } from "./tools/separate/vite-plugin.ts";

// The dev server watches every folder under the project. These hold no source and are big: with
// them watched it held 27,000 folder watches, and it stopped answering (1.9 GB, no reply in 25 s)
// when the datasets' 150,000 files were unpacked and deleted under it. Anchored to the project's
// folder, because `public/data` and `tools/data` are source.
const root = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");
const unwatched = ["data", "target", "out", "tools/eval/.venv", "tools/separate/.venv", "tools/separate/.cache"].map((d) => `${root}/${d}/**`);

export default defineConfig({
  plugins: [react(), separatePlugin()],
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: true },
  server: { host: "127.0.0.1", port: 5317, strictPort: true, allowedHosts: true, watch: { ignored: unwatched } },
  preview: { host: "127.0.0.1", port: 5318, strictPort: true, allowedHosts: true },
});
