// Packs TaskJuggler's Ruby sources + our stub + bridge into one JSON file
// ({ "path/in/vfs": "file contents" }) that the browser fetches once.
import fs from "node:fs";
import path from "node:path";
const out = {};
function add(root, prefix) {
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, ent.name);
    if (ent.isDirectory()) add(p, `${prefix}/${ent.name}`);
    else if (ent.name.endsWith(".rb")) out[`${prefix}/${ent.name}`] = fs.readFileSync(p, "utf8");
  }
}
add("vendor/tj/lib", "lib");
add("stubs", "lib");
add("bridge", "lib");
fs.writeFileSync("web/tj-bundle.json", JSON.stringify(out));
console.log(Object.keys(out).length, "files,", fs.statSync("web/tj-bundle.json").size, "bytes");
