#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
//
// check-binary.mjs - does a ruby.wasm binary contain OpenSSL? (phase-4 T13, ADR-0001)
//
//   node engine/ruby-wasm/check-binary.mjs <ruby.wasm>... [--expect-openssl] [--compare <stock-debug.wasm>]
//                                          [--json <file>]
//
// This is the licence gate for the engine binary: OpenSSL is Apache-2.0, which GPL-2.0 code may
// not ship with. For each binary it reports and checks these markers, any of which means OpenSSL
// code is in it:
// - banner: the version banner libcrypto compiles in (OPENSSL_VERSION_TEXT, "OpenSSL 3.2.0 23 Nov
//   2023");
// - extension: "openssl.so" as a C string, the name a statically linked openssl extension
//   registers under (ruby_init_ext in Ruby's extinit.c), which plain Ruby text in the packed
//   stdlib never is;
// - data: C strings that libcrypto always compiles in and a build cannot drop without patching it:
//   the OpenSSL_version() directory strings ("OPENSSLDIR: \"...", "ENGINESDIR: \"...",
//   "MODULESDIR: \"...") and object names from its OID table (obj_dat.h: rsaEncryption,
//   sha256WithRSAEncryption). Each is matched NUL-delimited, as C strings sit in the data section,
//   so Ruby source packed into the binary cannot match;
// - functions: in a binary with a name section (the debug build), functions of the openssl
//   extension or of libcrypto/libssl (OPENSSL_FUNCS). The prefixes are OpenSSL's API names. Ruby's
//   own digest code renames its MD5_/SHA1_/SHA256_/SHA512_ functions to rb_Digest_* (ext/digest,
//   "avoid name clash"), so they do not match.
// It also lists the native extensions registered in the binary (the "<name>.so" C strings).
// Exits 1 when a binary has any marker. With --expect-openssl (to check the check, on the stock
// binaries) it exits 1 unless a binary has every marker that applies to it: banner, extension,
// each data string, and, when it has a name section, at least one function.
//
// --compare <stock-debug.wasm>: for the debug builds among the binaries, also the functions that
// are in the stock binary but not in this one, their code size, and how many of them look like
// OpenSSL, so the gate can record what dropping the extension removed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const BANNER = /OpenSSL \d+\.\d+\.\d+[a-z]?(?:-[a-z0-9]+)? +\d{1,2} [A-Z][a-z]{2} \d{4}/;
export const EXT_NAME = '\0openssl.so\0';
/** NUL-delimited C strings of libcrypto, by marker name. */
export const DATA_MARKERS = /** @type {const} */ ({
	OPENSSLDIR: '\0OPENSSLDIR: "',
	ENGINESDIR: '\0ENGINESDIR: "',
	MODULESDIR: '\0MODULESDIR: "',
	rsaEncryption: '\0rsaEncryption\0',
	sha256WithRSAEncryption: '\0sha256WithRSAEncryption\0',
});
export const OPENSSL_FUNCS = new RegExp(
	'^(?:' +
		[
			// The openssl extension.
			'Init_openssl',
			'Init_ossl_\\w+',
			'ossl_\\w+',
			// libcrypto and libssl.
			'OpenSSL_version',
			'OPENSSL_\\w+',
			'OSSL_\\w+',
			'SSL_CTX_new',
			'SSL_new',
			'EVP_\\w+',
			'BN_\\w+',
			'X509_\\w+',
			'ASN1_\\w+',
			'ERR_\\w+',
			'BIO_\\w+',
			'CRYPTO_\\w+',
			'RSA_\\w+',
			'EC_\\w+',
			'PEM_\\w+',
			'MD5_\\w+',
			'SHA1_\\w+',
			'SHA256_\\w+',
			'SHA512_\\w+',
			'HMAC\\w*',
			'RAND_\\w+',
			'OBJ_\\w+',
			'd2i_\\w+',
			'i2d_\\w+',
		].join('|') +
		')$',
);

/**
 * The sections, function names and code sizes of a wasm module.
 * @param {Buffer} buf
 */
export function readWasm(buf) {
	if (buf.length < 8 || buf.readUInt32LE(0) !== 0x6d736100) throw new Error('not a wasm module');
	let p = 8;
	const leb = () => {
		let result = 0;
		let shift = 0;
		let b;
		do {
			b = buf[p++];
			if (b === undefined) throw new Error('truncated wasm module');
			result += (b & 0x7f) * 2 ** shift;
			shift += 7;
		} while (b & 0x80);
		return result;
	};
	const str = () => {
		const n = leb();
		const s = buf.toString('utf8', p, p + n);
		p += n;
		return s;
	};
	/** @type {{ id: number, name: string, start: number, end: number }[]} */
	const sections = [];
	while (p < buf.length) {
		const id = buf[p++] ?? 0;
		const size = leb();
		const start = p;
		const name = id === 0 ? str() : '';
		sections.push({ id, name, start: id === 0 ? p : start, end: start + size });
		p = start + size;
	}
	// Imported functions come first in the function index space.
	let imported = 0;
	const imports = sections.find((s) => s.id === 2);
	if (imports) {
		p = imports.start;
		for (let i = leb(); i > 0; i--) {
			str();
			str();
			const kind = buf[p++];
			if (kind === 0) {
				leb();
				imported++;
			} else if (kind === 1) {
				p++;
				const flags = leb();
				leb();
				if (flags & 1) leb();
			} else if (kind === 2) {
				const flags = leb();
				leb();
				if (flags & 1) leb();
			} else if (kind === 3) {
				p++;
				p++;
			} else throw new Error(`unknown import kind ${kind}`);
		}
	}
	/** @type {number[]} code body size per defined function */
	const bodySizes = [];
	const code = sections.find((s) => s.id === 10);
	if (code) {
		p = code.start;
		for (let i = leb(); i > 0; i--) {
			const size = leb();
			bodySizes.push(size);
			p += size;
		}
	}
	/** @type {Map<string, number>} function name -> code bytes (0 for imports) */
	const functions = new Map();
	const names = sections.find((s) => s.id === 0 && s.name === 'name');
	if (names) {
		p = names.start;
		while (p < names.end) {
			const sub = buf[p++];
			const size = leb();
			const end = p + size;
			if (sub === 1) {
				for (let i = leb(); i > 0; i--) {
					const index = leb();
					const name = str();
					functions.set(name, index < imported ? 0 : (bodySizes[index - imported] ?? 0));
				}
			}
			p = end;
		}
	}
	const sizeOf = (/** @type {number} */ id) =>
		sections.filter((s) => s.id === id).reduce((n, s) => n + (s.end - s.start), 0);
	return { functions, hasNames: Boolean(names), codeBytes: sizeOf(10), dataBytes: sizeOf(11) };
}

/** The native extensions a binary registers: "\0<feature>.so\0" C strings, sorted. */
export function extNames(/** @type {Buffer} */ buf) {
	const text = buf.toString('latin1');
	const out = new Set();
	for (const m of text.matchAll(/\0((?:[a-z0-9_]+\/)*[a-z0-9_]+)\.so(?=\0)/g)) out.add(m[1]);
	return [...out].sort();
}

/**
 * The OpenSSL markers of one binary.
 * @param {Buffer} buf
 */
export function inspectBuffer(buf) {
	const wasm = readWasm(buf);
	const banner = buf.toString('latin1').match(BANNER)?.[0] ?? null;
	const extensionRegistered = buf.includes(Buffer.from(EXT_NAME, 'latin1'));
	/** @type {Record<string, boolean>} */
	const data = {};
	for (const [name, text] of Object.entries(DATA_MARKERS)) {
		data[name] = buf.includes(Buffer.from(text, 'latin1'));
	}
	const opensslFunctions = [...wasm.functions.keys()].filter((n) => OPENSSL_FUNCS.test(n));
	const markers = {
		banner: Boolean(banner),
		extension: extensionRegistered,
		...Object.fromEntries(Object.entries(data).map(([k, v]) => [`data:${k}`, v])),
		...(wasm.hasNames ? { functions: opensslFunctions.length > 0 } : {}),
	};
	return {
		bytes: buf.length,
		codeBytes: wasm.codeBytes,
		dataBytes: wasm.dataBytes,
		nameSection: wasm.hasNames,
		openssl: {
			banner,
			extensionRegistered,
			data,
			functions: wasm.hasNames ? opensslFunctions.length : null,
			sample: opensslFunctions.slice(0, 5),
		},
		/** Every marker that applies to this binary: true where it was found. */
		markers,
		hasOpenSSL: Object.values(markers).some(Boolean),
		extensions: extNames(buf),
		_functions: wasm.functions,
	};
}

/**
 * Whether a binary passes: no marker at all, or with `expectOpenSSL` every applicable marker.
 * @param {ReturnType<typeof inspectBuffer>} r
 * @param {boolean} expectOpenSSL
 * @returns {string[]} what is wrong (empty when it passes)
 */
export function problems(r, expectOpenSSL) {
	const entries = Object.entries(r.markers);
	return expectOpenSSL
		? entries.filter(([, found]) => !found).map(([m]) => `expected OpenSSL marker ${m}, not found`)
		: entries.filter(([, found]) => found).map(([m]) => `OpenSSL marker ${m} found`);
}

function main() {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			'expect-openssl': { type: 'boolean', default: false },
			compare: { type: 'string' },
			json: { type: 'string' },
		},
	});
	if (!positionals.length) {
		console.error('usage: check-binary.mjs <ruby.wasm>... [--expect-openssl] [--compare <stock-debug.wasm>] [--json <file>]');
		process.exit(2);
	}
	const stock = values.compare ? inspectBuffer(fs.readFileSync(values.compare)) : null;
	if (stock && !stock.nameSection) throw new Error(`${values.compare} has no name section; pass the debug build`);
	let failed = false;
	const report = [];
	for (const file of positionals) {
		const r = inspectBuffer(fs.readFileSync(file));
		const o = r.openssl;
		const yes = (/** @type {boolean} */ b) => (b ? 'yes' : 'no');
		console.log(`${path.basename(file)}: ${r.bytes} bytes (code ${r.codeBytes}, data ${r.dataBytes})`);
		console.log(`  OpenSSL banner: ${o.banner ?? 'none'}; openssl.so registered: ${yes(o.extensionRegistered)}; ` +
			`OpenSSL functions: ${o.functions === null ? 'n/a (no name section)' : o.functions}` +
			(o.sample.length ? ` (${o.sample.join(', ')}, ...)` : ''));
		console.log(`  libcrypto strings: ${Object.entries(o.data).map(([k, v]) => `${k} ${yes(v)}`).join(', ')}`);
		console.log(`  native extensions (${r.extensions.length}): ${r.extensions.filter((e) => !e.startsWith('enc/')).join(' ')} + ${r.extensions.filter((e) => e.startsWith('enc/')).length} enc/*`);
		/** @type {Record<string, unknown>} */
		const entry = { file, ...r, _functions: undefined };
		if (stock && r.nameSection) {
			const removed = [...stock._functions].filter(([n]) => !r._functions.has(n));
			const added = [...r._functions.keys()].filter((n) => !stock._functions.has(n));
			const bytes = removed.reduce((n, [, size]) => n + size, 0);
			const ossl = removed.filter(([n]) => OPENSSL_FUNCS.test(n)).length;
			console.log(`  vs ${path.basename(values.compare ?? '')}: ${removed.length} functions gone (${bytes} code bytes, ` +
				`${ossl} matching the OpenSSL pattern), ${added.length} new`);
			entry['compare'] = { stock: values.compare, removedFunctions: removed.length, removedCodeBytes: bytes,
				removedOpenSSLPattern: ossl, addedFunctions: added.length, addedSample: added.slice(0, 20) };
		}
		const bad = problems(r, values['expect-openssl']);
		if (bad.length) {
			failed = true;
			for (const b of bad) console.log(`  FAIL: ${b}`);
		} else {
			const n = Object.keys(r.markers).length;
			console.log(`  ok: ${values['expect-openssl'] ? `all ${n} OpenSSL markers present, as expected` : `none of ${n} OpenSSL markers present`}`);
		}
		report.push(entry);
	}
	if (values.json) fs.writeFileSync(values.json, `${JSON.stringify(report, null, 2)}\n`);
	if (failed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
