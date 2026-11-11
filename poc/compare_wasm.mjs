import fs from "node:fs";
import { bootTaskJuggler } from "./web/tj-runtime.mjs";
const files = process.argv.slice(2);
const wasmModule = await WebAssembly.compile(fs.readFileSync("node_modules/@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm"));
const bundle = JSON.parse(fs.readFileSync("web/tj-bundle.json", "utf8"));
const tj = await bootTaskJuggler({ wasmModule, bundle });
const out = [];
for (const f of [...files, ...files]) {
  const r = tj.schedule(fs.readFileSync(f, "utf8"));
  out.push([f.split("/").pop(), r]);
  console.error(`${f.split("/").pop()}: ok=${r.ok} tasks=${r.tasks?.length} parse=${r.parseMs}ms sched=${r.scheduleMs}ms total=${r.totalMs}ms msgs=${r.messages.length}`);
}
fs.writeFileSync("/tmp/claude-0/wasm_results.json", JSON.stringify(out));
