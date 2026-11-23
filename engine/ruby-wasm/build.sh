#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# build.sh - build an OpenSSL-free ruby.wasm (CRuby 3.4.1, wasm32-wasip1) for the engine
# (phase-4 T13). See engine/ruby-wasm/README.md for the recipe and its evidence.
#
#   engine/ruby-wasm/build.sh [--toolchain wasi-sdk|ubuntu] [--no-vfs] [--work DIR] [--out DIR]
#   engine/ruby-wasm/build.sh --fetch-only [--toolchain ...] [--no-vfs] [--work DIR]
#   engine/ruby-wasm/build.sh --list-unpinned [--toolchain ...] [--no-vfs]
#
# --toolchain wasi-sdk (default): wasi-sdk 22.0, the toolchain ruby_wasm 2.10.1 builds Ruby 3.4
#   with. Needs github.com (wasi-sdk and wasi-vfs are published only as GitHub release assets).
# --toolchain ubuntu: Ubuntu 24.04's clang-18, lld-18 and llvm-18 (installed) plus the pinned
#   wasi-libc and wasm32 compiler-rt packages from archive.ubuntu.com. Not the shipping toolchain;
#   for building where github.com is unreachable.
# --no-vfs: no wasi-vfs. Writes ruby.wasm plus fs/ (the /usr and /bundle trees wasi-vfs would
#   pack) instead of ruby+stdlib.wasm. Not a drop-in engine binary; see build.rb.
# --fetch-only: download the inputs this toolchain and mode use, print the SHA-256 of each and
#   exit, without unpacking or running any of them. This is how a hash gets pinned: record it from
#   a fetch-only run, then write it into inputs.json. An unpinned input is always downloaded
#   afresh, never taken from <work>/downloads, so the hash printed is of what its host serves now.
#   Prints one line per input on stdout, "<STATUS> <key> <sha256> <file>", STATUS being PINNED,
#   UNPINNED or MISMATCH; exits 1 if any pinned input does not match its pin (after all of them).
# --list-unpinned: print the keys of the inputs this toolchain and mode use whose sha256 is null
#   in inputs.json (one line, space-separated, empty when every one is pinned) and exit 0.
#
# The build never runs with an unpinned input: it stops before downloading anything if one has no
# sha256. Every input is downloaded once into <work>/downloads and checked against inputs.json; a
# failed or partial download never becomes the cached file, and a cached file that does not match
# its pin is deleted. Nothing else is fetched during the build (the gems install with `bundle
# install --local`; build.rb refuses any download ruby_wasm would make itself).
# Outputs in <out> (default engine/ruby-wasm/out): ruby.debug+stdlib.wasm and ruby+stdlib.wasm
# (--vfs) or ruby.debug.wasm, ruby.wasm and fs/ (--no-vfs); exts.json; provenance.json. Then
# check-binary.mjs must find no OpenSSL in the result, or the build fails.
#
# Needs: bash 4.4 or later, curl, tar, unzip (--vfs), dpkg-deb, make, a C compiler for the host
# Ruby, Ruby 3.3 or later with Bundler (the host Ruby; it runs rbwasm), node (reads inputs.json),
# and for --toolchain ubuntu the packages clang-18, lld-18 and llvm-18. Disk: about 3 GB in <work>.
set -euo pipefail
# Without this, a command that fails inside $(...) (curl in fetch, say) does not stop the
# subshell, and the commands after it (the mv into the download cache) still run.
shopt -s inherit_errexit

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
toolchain=wasi-sdk
vfs=1
work="${MAINSPRING_RUBY_WASM_WORK:-${XDG_CACHE_HOME:-$HOME/.cache}/mainspring-ruby-wasm}"
out="$HERE/out"
mode=build
while [ $# -gt 0 ]; do
	case "$1" in
	--toolchain) toolchain="$2"; shift 2 ;;
	--toolchain=*) toolchain="${1#*=}"; shift ;;
	--no-vfs) vfs=0; shift ;;
	--work) work="$2"; shift 2 ;;
	--out) out="$2"; shift 2 ;;
	--fetch-only) mode=fetch-only; shift ;;
	--list-unpinned) mode=list-unpinned; shift ;;
	--record-unpinned)
		echo "build.sh: --record-unpinned is gone: run --fetch-only, pin the printed sha256, then build" >&2
		exit 2 ;;
	*) echo "build.sh: unknown argument $1" >&2; exit 2 ;;
	esac
done
case "$toolchain" in wasi-sdk | ubuntu) ;; *) echo "build.sh: --toolchain wasi-sdk or ubuntu" >&2; exit 2 ;; esac
log() { printf '[build.sh] %s\n' "$*" >&2; }

# input <key> <field>: a field of inputs.json (empty for null).
input() {
	node -e 'const v = require(process.argv[1]).inputs[process.argv[2]]; if (!v) process.exit(3);
		const f = v[process.argv[3]]; process.stdout.write(f == null ? "" : String(f));' \
		"$HERE/inputs.json" "$1" "$2"
}

# used_inputs [unpinned]: the keys of the inputs this toolchain and mode use, in inputs.json's
# order, space-separated; with "unpinned", only those whose sha256 is null.
used_inputs() {
	node -e 'const [file, toolchain, vfs, which] = process.argv.slice(1);
		const keys = Object.entries(require(file).inputs)
			.filter(([, v]) => !(v.toolchain && v.toolchain !== toolchain) && !(v.vfs_only && vfs !== "1"))
			.filter(([, v]) => which !== "unpinned" || v.sha256 == null)
			.map(([k]) => k);
		process.stdout.write(keys.join(" "));' "$HERE/inputs.json" "$toolchain" "$vfs" "${1:-all}"
}

if [ "$mode" = list-unpinned ]; then
	printf '%s\n' "$(used_inputs unpinned)"
	exit 0
fi

mkdir -p "$work/downloads"
work="$(cd "$work" && pwd)"
dl="$work/downloads"

# format_ok <file> <name>: does <file> start like the archive its name says (gzip, zip, Debian
# package, or a .gem's tar)? A host that answers with an HTML page (zlib.net's bot check does)
# must not become a cached file or a printed hash.
format_ok() {
	local magic
	case "$2" in
	*.tar.gz | *.tgz) magic=1f8b ;;
	*.zip) magic=504b0304 ;;
	*.deb) magic=213c617263683e0a ;;
	*.gem) [ "$(od -An -tx1 -j257 -N5 "$1" | tr -d ' \n')" = 7573746172 ]; return ;;
	*) return 0 ;;
	esac
	[ "$(od -An -tx1 -N$((${#magic} / 2)) "$1" | tr -d ' \n')" = "$magic" ]
}

# download <key> <url> <dest>: fetch <url> into <dest> unless a non-empty <dest> is there already.
# It downloads to <dest>.part first, so a failed, partial or wrong-format download never becomes
# <dest>.
download() {
	local key="$1" url="$2" dest="$3"
	[ -s "$dest" ] && return 0
	log "fetch $key: $url"
	rm -f "${dest:?}.part"
	curl -fsSL --retry 3 --max-time 900 -o "$dest.part" "$url" || {
		rm -f "${dest:?}.part"
		log "fetch $key failed: $url"
		exit 1
	}
	if ! format_ok "$dest.part" "$dest"; then
		log "fetch $key: $url did not answer with a $(basename "$dest") (starts: $(head -c 60 "$dest.part" | tr -c '[:print:]' '.'))"
		rm -f "${dest:?}.part"
		exit 1
	fi
	mv "$dest.part" "$dest"
}

sha256() { sha256sum "$1" | cut -d' ' -f1; }

if [ "$mode" = fetch-only ]; then
	log "fetch-only: toolchain $toolchain, wasi-vfs $([ "$vfs" = 1 ] && echo on || echo off); downloads in $dl"
	unpinned=()
	mismatched=()
	for key in $(used_inputs); do
		file="$(input "$key" file)"
		url="$(input "$key" url)"
		sha="$(input "$key" sha256)"
		# The hash of an unpinned input is about to be pinned: never take it from a cached file.
		[ -n "$sha" ] || rm -f "${dl:?}/${file:?}"
		download "$key" "$url" "$dl/$file"
		got="$(sha256 "$dl/$file")"
		if [ -z "$sha" ]; then
			printf 'UNPINNED %s %s %s\n' "$key" "$got" "$file"
			unpinned+=("$key")
		elif [ "$got" = "$sha" ]; then
			printf 'PINNED %s %s %s\n' "$key" "$got" "$file"
		else
			printf 'MISMATCH %s %s %s (inputs.json pins %s)\n' "$key" "$got" "$file" "$sha"
			rm -f "${dl:?}/${file:?}"
			mismatched+=("$key")
		fi
	done
	if [ "${#unpinned[@]}" -gt 0 ]; then
		log "fetch-only: ${#unpinned[@]} unpinned (${unpinned[*]}): copy each UNPINNED sha256 above into engine/ruby-wasm/inputs.json, then build"
	else
		log "fetch-only: every input is pinned"
	fi
	if [ "${#mismatched[@]}" -gt 0 ]; then
		log "fetch-only: ${mismatched[*]} did not match the pinned sha256 (deleted from the download cache)"
		exit 1
	fi
	exit 0
fi

# --- The build: every input it uses must be pinned before anything is fetched.
unpinned="$(used_inputs unpinned)"
if [ -n "$unpinned" ]; then
	log "inputs without a sha256 in inputs.json: $unpinned. Run build.sh --fetch-only (same --toolchain), pin the printed hashes, then build"
	exit 1
fi
mkdir -p "$out"
out="$(cd "$out" && pwd)"

# fetch <key>: download an input once and check its sha256; prints the local path. A cached file
# that does not match its pin is deleted, so the next run downloads it again.
fetch() {
	local key="$1" file url sha got
	file="$(input "$key" file)"
	url="$(input "$key" url)"
	sha="$(input "$key" sha256)"
	[ -n "$sha" ] || { log "$key has no sha256 in inputs.json"; exit 1; }
	download "$key" "$url" "$dl/$file"
	got="$(sha256 "$dl/$file")"
	if [ "$got" != "$sha" ]; then
		log "$key: sha256 $got, inputs.json pins $sha (deleted $dl/$file)"
		rm -f "${dl:?}/${file:?}"
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
[[ "$(wasm-opt --version)" == *"version 108"* ]] || { log "wasm-opt is not version 108"; exit 1; }

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
	[[ "$(clang-18 --version)" == *"version 18.1."* ]] || { log "clang-18 is not 18.1.x"; exit 1; }
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
clang_version="$("$sdk/bin/clang" --version)"
clang_version="${clang_version%%$'\n'*}"
log "WASI_SDK_PATH=$WASI_SDK_PATH ($clang_version)"

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

# The host tools that shaped the build, for provenance.json (none of them ships).
host_ruby="$(ruby -e 'print RUBY_DESCRIPTION')"
bundler_version="$(cd "$app" && bundle exec ruby -e 'print Bundler::VERSION')"
node -e '
const fs = require("node:fs"), crypto = require("node:crypto"), path = require("node:path");
const [inputsFile, outDir, toolchain, vfs, debug, final, dl, used, ...tools] = process.argv.slice(1);
const inputs = require(inputsFile).inputs;
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const p = {
	recipe: "engine/ruby-wasm/build.sh",
	toolchain, vfs: vfs === "1",
	tools: Object.fromEntries(tools.map((t) => [t.slice(0, t.indexOf("=")), t.slice(t.indexOf("=") + 1)])),
	exts: JSON.parse(fs.readFileSync(outDir + "/exts.json", "utf8")),
	inputs: Object.fromEntries(used.split(" ").map((k) => [k, { url: inputs[k].url, pinned: inputs[k].sha256, sha256: sha(dl + "/" + inputs[k].file) }])),
	outputs: Object.fromEntries([debug, final].map((f) => [path.basename(f), { bytes: fs.statSync(f).size, sha256: sha(f) }])),
};
fs.writeFileSync(outDir + "/provenance.json", JSON.stringify(p, null, 2) + "\n");
' "$HERE/inputs.json" "$out" "$toolchain" "$vfs" "$debug" "$final" "$dl" "$(used_inputs)" \
	"clang=$clang_version" "wasmOpt=$(wasm-opt --version)" "hostRuby=$host_ruby" "bundler=$bundler_version" \
	"node=$(node --version)" "os=$(uname -srm)"
log "wrote $out/provenance.json"
