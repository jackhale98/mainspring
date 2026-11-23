#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# build.sh - build an OpenSSL-free ruby.wasm (CRuby 3.4.1, wasm32-wasip1) for the engine
# (phase-4 T13). See engine/ruby-wasm/README.md for the recipe and its evidence.
#
#   engine/ruby-wasm/build.sh [--toolchain wasi-sdk|ubuntu] [--no-vfs] [--work DIR] [--out DIR]
#                             [--record-unpinned]
#
# --toolchain wasi-sdk (default): wasi-sdk 22.0, the toolchain ruby_wasm 2.10.1 builds Ruby 3.4
#   with. Needs github.com (wasi-sdk and wasi-vfs are published only as GitHub release assets).
# --toolchain ubuntu: Ubuntu 24.04's clang-18, lld-18 and llvm-18 (installed) plus the pinned
#   wasi-libc and wasm32 compiler-rt packages from archive.ubuntu.com. Not the shipping toolchain;
#   for building where github.com is unreachable.
# --no-vfs: no wasi-vfs. Writes ruby.wasm plus fs/ (the /usr and /bundle trees wasi-vfs would
#   pack) instead of ruby+stdlib.wasm. Not a drop-in engine binary; see build.rb.
# --record-unpinned: accept inputs whose sha256 is null in inputs.json and print the hashes to
#   pin. Without it a null hash fails the build.
#
# Every input is downloaded once into <work>/downloads and checked against inputs.json; nothing
# else is fetched during the build (the gems install with `bundle install --local`).
# Outputs in <out> (default engine/ruby-wasm/out): ruby.debug+stdlib.wasm and ruby+stdlib.wasm
# (--vfs) or ruby.debug.wasm, ruby.wasm and fs/ (--no-vfs); exts.json; provenance.json. Then
# check-binary.mjs must find no OpenSSL in the result, or the build fails.
#
# Needs: bash, curl, tar, unzip (--vfs), dpkg-deb, make, a C compiler for the host Ruby, Ruby
# 3.3 or later with Bundler (the host Ruby; it runs rbwasm), node (reads inputs.json), and for
# --toolchain ubuntu the packages clang-18, lld-18 and llvm-18. Disk: about 3 GB in <work>.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
toolchain=wasi-sdk
vfs=1
work="${MAINSPRING_RUBY_WASM_WORK:-${XDG_CACHE_HOME:-$HOME/.cache}/mainspring-ruby-wasm}"
out="$HERE/out"
record=0
while [ $# -gt 0 ]; do
	case "$1" in
	--toolchain) toolchain="$2"; shift 2 ;;
	--toolchain=*) toolchain="${1#*=}"; shift ;;
	--no-vfs) vfs=0; shift ;;
	--work) work="$2"; shift 2 ;;
	--out) out="$2"; shift 2 ;;
	--record-unpinned) record=1; shift ;;
	*) echo "build.sh: unknown argument $1" >&2; exit 2 ;;
	esac
done
case "$toolchain" in wasi-sdk | ubuntu) ;; *) echo "build.sh: --toolchain wasi-sdk or ubuntu" >&2; exit 2 ;; esac
mkdir -p "$work/downloads" "$out"
work="$(cd "$work" && pwd)"
out="$(cd "$out" && pwd)"
dl="$work/downloads"
log() { printf '[build.sh] %s\n' "$*" >&2; }

# input <key> <field>: a field of inputs.json (empty for null).
input() {
	node -e 'const v = require(process.argv[1]).inputs[process.argv[2]]; if (!v) process.exit(3);
		const f = v[process.argv[3]]; process.stdout.write(f == null ? "" : String(f));' \
		"$HERE/inputs.json" "$1" "$2"
}

# fetch <key>: download an input once and check its sha256; prints the local path.
fetch() {
	local key="$1" file url sha got
	file="$(input "$key" file)"
	url="$(input "$key" url)"
	sha="$(input "$key" sha256)"
	if [ ! -s "$dl/$file" ]; then
		log "fetch $key: $url"
		curl -fsSL --retry 3 --max-time 900 -o "$dl/$file.part" "$url"
		mv "$dl/$file.part" "$dl/$file"
	fi
	got="$(sha256sum "$dl/$file" | cut -d' ' -f1)"
	if [ -z "$sha" ]; then
		if [ "$record" = 1 ]; then
			log "UNPINNED $key: sha256 $got ($file); pin it in inputs.json"
		else
			log "$key has no sha256 in inputs.json (got $got); pin it, or run with --record-unpinned"
			exit 1
		fi
	elif [ "$got" != "$sha" ]; then
		log "$key: sha256 $got, inputs.json pins $sha"
		exit 1
	fi
	printf '%s\n' "$dl/$file"
}

# deb_extract <deb> <dir>
deb_extract() { mkdir -p "$2" && dpkg-deb -x "$1" "$2"; }

tc="$work/toolchain"
mkdir -p "$tc"

# --- binaryen (wasm-opt 108)
binaryen_deb="$(fetch binaryen)"
[ -x "$tc/binaryen/usr/bin/wasm-opt" ] || deb_extract "$binaryen_deb" "$tc/binaryen"
export PATH="$tc/binaryen/usr/bin:$PATH"
wasm-opt --version | grep -q 'version 108' || { log "wasm-opt is not version 108"; exit 1; }

# --- WASI SDK
if [ "$toolchain" = wasi-sdk ]; then
	sdk_tar="$(fetch wasi_sdk)"
	sdk="$tc/wasi-sdk-22.0"
	if [ ! -x "$sdk/bin/clang" ]; then
		mkdir -p "$sdk"
		tar -C "$sdk" --strip-components 1 -xzf "$sdk_tar"
	fi
else
	# A WASI SDK layout around the system LLVM 18: bin/ wrappers, share/wasi-sysroot from the
	# wasi-libc package, and a clang resource dir with the wasm32 builtins.
	command -v clang-18 >/dev/null || { log "--toolchain ubuntu needs clang-18 (apt-get install clang-18 lld-18 llvm-18)"; exit 1; }
	clang-18 --version | grep -q 'version 18\.1\.' || { log "clang-18 is not 18.1.x"; exit 1; }
	llvm_bin="$(dirname "$(readlink -f "$(command -v clang-18)")")"
	[ -x "$llvm_bin/wasm-ld" ] || { log "no wasm-ld next to clang-18 (install lld-18)"; exit 1; }
	# Named after the packages it is made of, so a changed pin never reuses a stale sysroot.
	sdk="$tc/wasi-sdk-ubuntu-$(printf '%s %s' "$(input ubuntu_wasi_libc sha256)" "$(input ubuntu_compiler_rt sha256)" | sha256sum | cut -c1-12)"
	if [ ! -x "$sdk/bin/clang" ]; then
		root="$tc/ubuntu-root"
		libc_deb="$(fetch ubuntu_wasi_libc)"
		rt_deb="$(fetch ubuntu_compiler_rt)"
		deb_extract "$libc_deb" "$root"
		deb_extract "$rt_deb" "$root"
		mkdir -p "$sdk/bin" "$sdk/share/wasi-sysroot/include" "$sdk/share/wasi-sysroot/lib" "$sdk/lib/clang/18/lib"
		cp -a "$root/usr/include/wasm32-wasi" "$sdk/share/wasi-sysroot/include/"
		cp -a "$root/usr/lib/wasm32-wasi" "$sdk/share/wasi-sysroot/lib/"
		resource="$("$llvm_bin/clang" -print-resource-dir)"
		cp -a "$resource/include" "$sdk/lib/clang/18/"
		cp -a "$root/usr/lib/llvm-18/lib/clang/18/lib/wasi" "$sdk/lib/clang/18/lib/"
		for cc in clang clang++; do
			cat >"$sdk/bin/$cc" <<-EOF
				#!/bin/sh
				# wasi-sdk's $cc targets wasm32-wasi with its sysroot by default; so does this one.
				exec "$llvm_bin/$cc" --target=wasm32-wasi --sysroot="$sdk/share/wasi-sysroot" -resource-dir="$sdk/lib/clang/18" "\$@"
			EOF
			chmod +x "$sdk/bin/$cc"
		done
		for t in llvm-ar llvm-ranlib llvm-nm llvm-strip; do ln -sf "$llvm_bin/$t" "$sdk/bin/$t"; done
		ln -sf "$llvm_bin/wasm-ld" "$sdk/bin/wasm-ld"
	fi
fi
export WASI_SDK_PATH="$sdk"
log "WASI_SDK_PATH=$WASI_SDK_PATH ($("$sdk/bin/clang" --version | head -1))"

# --- wasi-vfs
if [ "$vfs" = 1 ]; then
	vfs_zip="$(fetch wasi_vfs)"
	mkdir -p "$tc/wasi-vfs"
	[ -f "$tc/wasi-vfs/libwasi_vfs.a" ] || unzip -o -q "$vfs_zip" libwasi_vfs.a -d "$tc/wasi-vfs"
	export LIB_WASI_VFS_A="$tc/wasi-vfs/libwasi_vfs.a"
else
	unset LIB_WASI_VFS_A || true
fi

# --- Sources and gems
ruby_tar="$(fetch ruby)"
libyaml_tar="$(fetch libyaml)"
if [ "$toolchain" = ubuntu ]; then zlib_tar="$(fetch ubuntu_zlib)"; else zlib_tar="$(fetch zlib)"; fi
app="$work/bundle-app"
mkdir -p "$app/vendor/cache"
cp "$HERE/Gemfile" "$HERE/Gemfile.lock" "$app/"
for g in ruby_wasm_gem js_gem logger_gem; do
	gem_file="$(fetch "$g")"
	cp "$gem_file" "$app/vendor/cache/"
done
export BUNDLE_GEMFILE="$app/Gemfile" BUNDLE_PATH="$app/vendor/bundle" BUNDLE_FROZEN=true \
	BUNDLE_DISABLE_SHARED_GEMS=true BUNDLE_APP_CONFIG="$app/.bundle"
(cd "$app" && bundle install --local --quiet)

# --- Build
if [ "$vfs" = 1 ]; then debug="$out/ruby.debug+stdlib.wasm" final="$out/ruby+stdlib.wasm"; else debug="$out/ruby.debug.wasm" final="$out/ruby.wasm"; fi
mode_args=()
[ "$vfs" = 1 ] || mode_args=(--no-vfs --fs-dir "$out/fs")
# ruby_wasm caches its build directories by name only (not by toolchain or inputs), so each
# combination of toolchain, wasi-vfs and recipe files gets its own root.
key="$(cat "$HERE/inputs.json" "$HERE/build.rb" "$HERE/Gemfile.lock" | sha256sum | cut -c1-12)"
root="$work/rbwasm-$toolchain-vfs$vfs-$key"
start=$(date +%s)
(cd "$app" && bundle exec ruby "$HERE/build.rb" --root "$root" --ruby-tarball "$ruby_tar" \
	--libyaml-tarball "$libyaml_tar" --zlib-tarball "$zlib_tar" --output "$debug" \
	--exts-file "$out/exts.json" "${mode_args[@]}")
# As ruby.wasm's npm packaging does (rakelib/packaging.rake): the shipped binary is stripped.
wasm-opt --strip-debug "$debug" -o "$final"
log "built in $(($(date +%s) - start)) s: $final"

node "$HERE/check-binary.mjs" "$debug" "$final"

node -e '
const fs = require("node:fs"), crypto = require("node:crypto");
const [inputsFile, outDir, toolchain, vfs, debug, final, sdk, dl] = process.argv.slice(1);
const inputs = require(inputsFile).inputs;
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const used = Object.entries(inputs).filter(([k, v]) =>
	!(v.toolchain && v.toolchain !== toolchain) && !(k === "wasi_vfs" && vfs !== "1"));
const p = {
	recipe: "engine/ruby-wasm/build.sh",
	toolchain, vfs: vfs === "1",
	clang: require("node:child_process").execFileSync(sdk + "/bin/clang", ["--version"]).toString().split("\n")[0],
	exts: JSON.parse(fs.readFileSync(outDir + "/exts.json", "utf8")),
	inputs: Object.fromEntries(used.map(([k, v]) => [k, { url: v.url, pinned: v.sha256, sha256: sha(dl + "/" + v.file) }])),
	outputs: Object.fromEntries([debug, final].map((f) => [require("node:path").basename(f), { bytes: fs.statSync(f).size, sha256: sha(f) }])),
};
fs.writeFileSync(outDir + "/provenance.json", JSON.stringify(p, null, 2) + "\n");
' "$HERE/inputs.json" "$out" "$toolchain" "$vfs" "$debug" "$final" "$sdk" "$dl"
log "wrote $out/provenance.json"
