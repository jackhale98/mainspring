#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
//
// check-binary.mjs - does a ruby.wasm binary contain OpenSSL? (phase-4 T13, ADR-0001)
//
//   node engine/ruby-wasm/check-binary.mjs <ruby.wasm>... [--expect-openssl] [--compare <stock-debug.wasm>]
//                                          [--json <file>]
//
// For each binary it reports and checks three markers, any of which means OpenSSL code is in it:
// - the version banner libcrypto compiles in (OPENSSL_VERSION_TEXT, "OpenSSL 3.2.0 23 Nov 2023");
// - "openssl.so" as a C string: the name a statically linked openssl extension registers under
//   (ruby_init_ext in Ruby's extinit.c), which plain Ruby text in the packed stdlib never is;
// - in a binary with a name section (the debug build), functions of the openssl extension or of
//   libcrypto/libssl: Init_openssl, ossl_*, and a few canonical libcrypto/libssl entry points.
// It also lists the native extensions registered in the binary (the "<name>.so" C strings).
// Exits 1 when a binary has a marker, or with --expect-openssl when one has none (to check the
// check on the stock binary).
//
// --compare <stock-debug.wasm>: for the debug builds among the binaries, also the functions that
// are in the stock binary but not in this one, their code size, and how many of them look like
// OpenSSL, so the gate can record what dropping the extension removed.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const BANNER = /OpenSSL \d+\.\d+\.\d+[a-z]?(?:-[a-z0-9]+)? +\d{1,2} [A-Z][a-z]{2} \d{4}/;
const EXT_NAME = Buffer.from('\0openssl.so\0', 'latin1');
const OPENSSL_FUNCS = /^(?:Init_openssl|Init_ossl_\w+|ossl_\w+|OpenSSL_version|OPENSSL_\w+|SSL_CTX_new|SSL_new|EVP_\w+|BN_\w+|X509_\w+|ASN1_\w+|ERR_\w+|BIO_\w+|CRYPTO_\w+|RSA_\w+|EC_\w+|PEM_\w+)$/;

/** @param {Buffer} buf */
function readWasm(buf) {
	if (buf.readUInt32LE(0) !== 0x6d736100) throw new Error('not a wasm module');
	let p = 8;
	const leb = () => {
		let result = 0;
		let shift = 0;
		let b;
		do {
			b = buf[p++];
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
		const id = buf[p++];
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
function extNames(/** @type {Buffer} */ buf) {
	const text = buf.toString('latin1');
	const out = new Set();
	for (const m of text.matchAll(/\0((?:[a-z0-9_]+\/)*[a-z0-9_]+)\.so(?=\0)/g)) out.add(m[1]);
	return [...out].sort();
}

function inspect(file) {
	const buf = fs.readFileSync(file);
	const wasm = readWasm(buf);
	const banner = buf.toString('latin1').match(BANNER)?.[0] ?? null;
	const extRegistered = buf.indexOf(EXT_NAME) >= 0;
	const opensslFunctions = [...wasm.functions.keys()].filter((n) => OPENSSL_FUNCS.test(n));
	return {
		file,
		bytes: buf.length,
		codeBytes: wasm.codeBytes,
		dataBytes: wasm.dataBytes,
		nameSection: wasm.hasNames,
		openssl: {
			banner,
			extensionRegistered: extRegistered,
			functions: wasm.hasNames ? opensslFunctions.length : null,
			sample: opensslFunctions.slice(0, 5),
		},
		hasOpenSSL: Boolean(banner) || extRegistered || opensslFunctions.length > 0,
		extensions: extNames(buf),
		_functions: wasm.functions,
	};
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
	const stock = values.compare ? inspect(values.compare) : null;
	if (stock && !stock.nameSection) throw new Error(`${values.compare} has no name section; pass the debug build`);
	let failed = false;
	const report = [];
	for (const file of positionals) {
		const r = inspect(file);
		const o = r.openssl;
		console.log(`${path.basename(file)}: ${r.bytes} bytes (code ${r.codeBytes}, data ${r.dataBytes})`);
		console.log(`  OpenSSL banner: ${o.banner ?? 'none'}; openssl.so registered: ${o.extensionRegistered ? 'yes' : 'no'}; ` +
			`OpenSSL functions: ${o.functions === null ? 'n/a (no name section)' : o.functions}` +
			(o.sample.length ? ` (${o.sample.join(', ')}, ...)` : ''));
		console.log(`  native extensions (${r.extensions.length}): ${r.extensions.filter((e) => !e.startsWith('enc/')).join(' ')} + ${r.extensions.filter((e) => e.startsWith('enc/')).length} enc/*`);
		/** @type {Record<string, unknown>} */
		const entry = { ...r, _functions: undefined };
		if (stock && r.nameSection) {
			const removed = [...stock._functions].filter(([n]) => !r._functions.has(n));
			const added = [...r._functions.keys()].filter((n) => !stock._functions.has(n));
			const bytes = removed.reduce((n, [, size]) => n + size, 0);
			const ossl = removed.filter(([n]) => OPENSSL_FUNCS.test(n)).length;
			console.log(`  vs ${path.basename(values.compare)}: ${removed.length} functions gone (${bytes} code bytes, ` +
				`${ossl} matching the OpenSSL pattern), ${added.length} new`);
			entry.compare = { stock: values.compare, removedFunctions: removed.length, removedCodeBytes: bytes,
				removedOpenSSLPattern: ossl, addedFunctions: added.length, addedSample: added.slice(0, 20) };
		}
		const bad = values['expect-openssl'] ? !r.hasOpenSSL : r.hasOpenSSL;
		if (bad) {
			failed = true;
			console.log(`  FAIL: ${values['expect-openssl'] ? 'expected OpenSSL, found none' : 'OpenSSL is in this binary'}`);
		} else console.log(`  ok: ${r.hasOpenSSL ? 'OpenSSL present, as expected' : 'no OpenSSL'}`);
		report.push(entry);
	}
	if (values.json) fs.writeFileSync(values.json, `${JSON.stringify(report, null, 2)}\n`);
	if (failed) process.exitCode = 1;
}

main();
