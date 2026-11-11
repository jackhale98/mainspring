import fs from "node:fs";
const page = fs.readFileSync("web/page.src.html", "utf8");
const runtime = fs.readFileSync("web/tj-runtime.js", "utf8").replace(/<\/script/gi, "<\\/script");
const sample = JSON.stringify(fs.readFileSync("web/sample.tjp", "utf8")).replace(/<\/script/gi, "<\\/script");
const out = page.replace("/*__RUNTIME__*/", () => runtime).replace('/*__SAMPLE__*/""', () => sample);
fs.mkdirSync("site", { recursive: true });
fs.writeFileSync("site/index.html", out);
fs.copyFileSync("web/ruby.wasm.gz", "site/ruby.wasm.gz");
fs.copyFileSync("web/tj-bundle.json.gz", "site/tj-bundle.json.gz");
// local preview wrapper mimicking the publish skeleton
fs.writeFileSync("site/preview.html", `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui}[hidden]{display:none!important}</style></head><body>${out}</body></html>`);
console.log("index.html", fs.statSync("site/index.html").size, "bytes");
