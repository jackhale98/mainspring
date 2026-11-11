import fs from "node:fs";
import { bootTaskJuggler } from "./web/tj-runtime.mjs";
const [example, n = 3] = process.argv.slice(2);
const wasmModule = await WebAssembly.compile(fs.readFileSync("node_modules/@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm"));
const bundle = JSON.parse(fs.readFileSync("web/tj-bundle.json", "utf8"));
const tj = await bootTaskJuggler({ wasmModule, bundle });
const src = fs.readFileSync(example, "utf8");
for (let i = 0; i < +n; i++) {
  const r = tj.schedule(src);
  console.log(`run ${i}: ok=${r.ok} parse=${r.parseMs}ms sched=${r.scheduleMs}ms total=${r.totalMs}ms gc=${tj.vm.eval("GC.count").toString()} live=${tj.vm.eval("GC.stat(:heap_live_slots)").toString()}`);
}
