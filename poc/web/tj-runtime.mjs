// tj-runtime.mjs - boots CRuby (ruby.wasm) with TaskJuggler's sources in an
// in-memory filesystem and exposes schedule(tjpText) -> result object.
// Works in browsers and in Node (pass the module bytes + bundle in).
import { File, OpenFile, PreopenDirectory, Directory, WASI, ConsoleStdout } from "@bjorn3/browser_wasi_shim";
import { RubyVM } from "@ruby/wasm-wasi";

function tree(files) {
  const root = new Map();
  for (const [p, content] of Object.entries(files)) {
    const parts = p.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      if (!dir.has(part)) dir.set(part, new Directory(new Map()));
      dir = dir.get(part).contents;
    }
    dir.set(parts.at(-1), new File(new TextEncoder().encode(content)));
  }
  return root;
}

// Time-zone helpers used by tj_wasm_tz.rb (WASI libc only knows UTC).
const fmtCache = new Map();
function fmt(zone) {
  if (!fmtCache.has(zone)) {
    fmtCache.set(zone, new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric",
      day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
    }));
  }
  return fmtCache.get(zone);
}
globalThis.tjTz = {
  offset(zone, epochSec) {
    const p = Object.fromEntries(fmt(zone).formatToParts(new Date(epochSec * 1000))
      .map((x) => [x.type, x.value]));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return Math.round((asUtc - epochSec * 1000) / 1000);
  },
  valid(zone) {
    try { fmt(zone); return true; } catch { return false; }
  },
};

export async function bootTaskJuggler({ wasmModule, bundle, log = () => {} }) {
  const t0 = performance.now();
  const fsTree = tree(bundle);
  fsTree.set("work", new Directory(new Map()));
  const fds = [
    new OpenFile(new File([])),
    ConsoleStdout.lineBuffered((l) => log("[stdout] " + l)),
    ConsoleStdout.lineBuffered((l) => log("[stderr] " + l)),
    new PreopenDirectory("/tj", fsTree),
  ];
  const wasi = new WASI([], ["LANG=C.UTF-8", "HOME=/tj/work"], fds, { debug: false });
  const { vm } = await RubyVM.instantiateModule({ module: wasmModule, wasip1: wasi });
  const t1 = performance.now();
  vm.eval(`$LOAD_PATH.unshift("/tj/lib"); Dir.chdir("/tj/work"); require "tj_bridge"`);
  const t2 = performance.now();
  log(`ruby boot ${Math.round(t1 - t0)}ms, TaskJuggler load ${Math.round(t2 - t1)}ms`);
  return {
    vm,
    bootMs: Math.round(t1 - t0), loadMs: Math.round(t2 - t1),
    schedule(src) {
      const t = performance.now();
      const res = vm.eval("TJBridge").call("run", vm.wrap(src)).toString();
      const obj = JSON.parse(res);
      obj.totalMs = Math.round(performance.now() - t);
      return obj;
    },
  };
}

// Browser entry: download the gzipped Ruby runtime and TaskJuggler sources
// that are published next to the page, then boot.
async function fetchMaybeGzip(url, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = +res.headers.get("content-length") || 0;
  const reader = res.body.getReader();
  const chunks = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length; onBytes?.(got, total);
  }
  let buf = new Uint8Array(got); let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    buf = new Uint8Array(await new Response(ds).arrayBuffer());
  }
  return buf;
}

export async function loadTaskJuggler({ wasmUrl, bundleUrl, onProgress = () => {} }) {
  const t0 = performance.now();
  onProgress({ stage: "download", got: 0, total: 0 });
  const [wasmBytes, bundleBytes] = await Promise.all([
    fetchMaybeGzip(wasmUrl, (got, total) => onProgress({ stage: "download", got, total })),
    fetchMaybeGzip(bundleUrl),
  ]);
  const t1 = performance.now();
  onProgress({ stage: "compile" });
  const wasmModule = await WebAssembly.compile(wasmBytes);
  const bundle = JSON.parse(new TextDecoder().decode(bundleBytes));
  onProgress({ stage: "boot" });
  const tj = await bootTaskJuggler({ wasmModule, bundle });
  tj.downloadMs = Math.round(t1 - t0);
  tj.compileMs = Math.round(performance.now() - t1) - tj.bootMs - tj.loadMs;
  tj.wasmBytes = wasmBytes.length;
  return tj;
}
