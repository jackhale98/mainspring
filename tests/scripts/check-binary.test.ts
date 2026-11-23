// SPDX-License-Identifier: GPL-2.0-or-later
// engine/ruby-wasm/check-binary.mjs is the licence gate for the engine binary (phase-4 T13,
// ADR-0001): it must find every OpenSSL marker it claims to, in small synthetic modules here and in
// the stock binaries of @ruby/3.4-wasm-wasi, and must not flag Ruby's own code or text.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
	DATA_MARKERS,
	OPENSSL_FUNCS,
	extNames,
	inspectBuffer,
	problems,
	readWasm,
} from '../../engine/ruby-wasm/check-binary.mjs';

const SCRIPT = 'engine/ruby-wasm/check-binary.mjs';
const STOCK = 'node_modules/@ruby/3.4-wasm-wasi/dist';

function leb(n: number): number[] {
	const out: number[] = [];
	do {
		let b = n & 0x7f;
		n >>>= 7;
		if (n) b |= 0x80;
		out.push(b);
	} while (n);
	return out;
}
const bytes = (s: string) => [...Buffer.from(s, 'latin1')];
const vec = (items: number[][]) => [...leb(items.length), ...items.flat()];
const name = (s: string) => [...leb(Buffer.byteLength(s, 'latin1')), ...bytes(s)];
const section = (id: number, content: number[]) => [id, ...leb(content.length), ...content];

/**
 * A valid wasm module: one imported function (env.imported), the given defined functions (body i
 * has i nops, so its size is i + 2), one page of memory, the data strings as active segments and,
 * unless `names` is false, a name section naming every function.
 */
function wasm(o: { functions?: string[]; data?: string[]; names?: boolean }): Buffer {
	const fns = o.functions ?? ['main'];
	const type = section(1, vec([[0x60, 0, 0]]));
	const imports = section(2, vec([[...name('env'), ...name('imported'), 0, 0]]));
	const func = section(3, vec(fns.map(() => [0])));
	const memory = section(5, vec([[0, 1]]));
	const code = section(
		10,
		vec(fns.map((_, i) => [...leb(i + 2), 0, ...Array<number>(i).fill(0x01), 0x0b])),
	);
	let offset = 0;
	const data = section(
		11,
		vec(
			(o.data ?? []).map((s) => {
				const seg = [0, 0x41, ...leb(offset), 0x0b, ...leb(s.length), ...bytes(s)];
				offset += s.length;
				return seg;
			}),
		),
	);
	const fnNames = vec([
		[...leb(0), ...name('imported')],
		...fns.map((f, i) => [...leb(i + 1), ...name(f)]),
	]);
	const nameSection = section(0, [...name('name'), 1, ...leb(fnNames.length), ...fnNames]);
	const buf = Buffer.from([
		...[0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0],
		...type,
		...imports,
		...func,
		...memory,
		...code,
		...data,
		...(o.names === false ? [] : nameSection),
	]);
	expect(WebAssembly.validate(buf)).toBe(true);
	return buf;
}

const BANNER_TEXT = '\0OpenSSL 3.2.0 23 Nov 2023\0';
const ALL_DATA = [BANNER_TEXT, '\0openssl.so\0', ...Object.values(DATA_MARKERS)];

describe('readWasm', () => {
	it('names functions, with imports first in the index space and their code sizes', () => {
		const r = readWasm(wasm({ functions: ['a', 'b', 'c'] }));
		expect(r.hasNames).toBe(true);
		expect([...r.functions]).toEqual([
			['imported', 0],
			['a', 2],
			['b', 3],
			['c', 4],
		]);
	});

	it('has no names without a name section (a stripped build)', () => {
		const r = readWasm(wasm({ functions: ['ossl_raise'], names: false }));
		expect(r.hasNames).toBe(false);
		expect(r.functions.size).toBe(0);
	});

	it('rejects what is not a wasm module', () => {
		expect(() => readWasm(Buffer.from('not wasm at all'))).toThrow(/not a wasm module/);
	});
});

describe('inspectBuffer and problems', () => {
	it('passes a clean module, and fails it when OpenSSL is expected, naming each missing marker', () => {
		const r = inspectBuffer(wasm({ functions: ['main', 'Init_digest'], data: ['hello\0'] }));
		expect(r.hasOpenSSL).toBe(false);
		expect(problems(r, false)).toEqual([]);
		expect(problems(r, true)).toEqual([
			'expected OpenSSL marker banner, not found',
			'expected OpenSSL marker extension, not found',
			...Object.keys(DATA_MARKERS).map((k) => `expected OpenSSL marker data:${k}, not found`),
			'expected OpenSSL marker functions, not found',
		]);
	});

	it.each([
		['the version banner', BANNER_TEXT, 'banner'],
		['openssl.so registered', '\0zlib.so\0openssl.so\0', 'extension'],
		...Object.entries(DATA_MARKERS).map(([k, s]) => [`the ${k} string`, `x${s}y\0`, `data:${k}`]),
	])('flags %s on its own', (_, text, marker) => {
		const r = inspectBuffer(wasm({ data: [text] }));
		expect(r.hasOpenSSL).toBe(true);
		expect(problems(r, false)).toEqual([`OpenSSL marker ${marker} found`]);
	});

	it.each([
		'Init_openssl',
		'Init_ossl_digest',
		'ossl_raise',
		'OpenSSL_version',
		'OPENSSL_init_crypto',
		'OSSL_PARAM_construct_end',
		'SSL_CTX_new',
		'EVP_DigestInit_ex',
		'BN_new',
		'X509_free',
		'ASN1_item_d2i',
		'ERR_get_error',
		'BIO_new',
		'CRYPTO_malloc',
		'RSA_new',
		'EC_KEY_new',
		'PEM_read_bio_X509',
		'MD5_Init',
		'SHA1_Update',
		'SHA256_Final',
		'SHA512_Transform',
		'HMAC',
		'HMAC_CTX_new',
		'RAND_bytes',
		'OBJ_nid2sn',
		'd2i_X509',
		'i2d_PUBKEY',
	])('flags the function %s in a debug build', (fn) => {
		expect(OPENSSL_FUNCS.test(fn)).toBe(true);
		const r = inspectBuffer(wasm({ functions: ['main', fn] }));
		expect(r.openssl.functions).toBe(1);
		expect(problems(r, false)).toEqual(['OpenSSL marker functions found']);
	});

	it("does not flag Ruby's own digest, random and object functions", () => {
		const own = [
			'rb_Digest_MD5_Init',
			'rb_Digest_SHA1_Update',
			'rb_Digest_SHA256_Finish',
			'rb_Digest_SHA512_Init',
			'Init_digest',
			'Init_md5',
			'rb_random_bytes',
			'rb_obj_class',
			'rb_hash_aref',
			'md5_process',
			'sha256_transform',
			'ossl',
			'hmac',
		];
		for (const fn of own) expect(OPENSSL_FUNCS.test(fn), fn).toBe(false);
		const r = inspectBuffer(wasm({ functions: own }));
		expect(r.hasOpenSSL).toBe(false);
	});

	it('does not flag the marker words as Ruby text, only as C strings', () => {
		const text = [
			'# OpenSSL::OPENSSL_VERSION, e.g. OPENSSLDIR: "/usr/local/ssl"\n',
			'cert.signature_algorithm == \'sha256WithRSAEncryption\' || alg == "rsaEncryption"\n',
			'require "openssl.so"\nENGINESDIR: "x" MODULESDIR: "y"\n',
		];
		const r = inspectBuffer(wasm({ data: text }));
		expect(r.markers).toEqual({
			banner: false,
			extension: false,
			...Object.fromEntries(Object.keys(DATA_MARKERS).map((k) => [`data:${k}`, false])),
			functions: false,
		});
	});

	it('expects every applicable marker: all present passes, one missing fails', () => {
		const full = inspectBuffer(wasm({ functions: ['ossl_raise'], data: ALL_DATA }));
		expect(problems(full, true)).toEqual([]);
		const noRsa = inspectBuffer(
			wasm({ functions: ['ossl_raise'], data: ALL_DATA.filter((s) => !s.includes('rsaEnc')) }),
		);
		expect(problems(noRsa, true)).toEqual([
			'expected OpenSSL marker data:rsaEncryption, not found',
		]);
		const noFunctions = inspectBuffer(wasm({ functions: ['main'], data: ALL_DATA }));
		expect(problems(noFunctions, true)).toEqual(['expected OpenSSL marker functions, not found']);
	});

	it('does not expect functions from a build without a name section', () => {
		const r = inspectBuffer(wasm({ functions: ['ossl_raise'], data: ALL_DATA, names: false }));
		expect(r.openssl.functions).toBeNull();
		expect(Object.keys(r.markers)).not.toContain('functions');
		expect(problems(r, true)).toEqual([]);
	});
});

describe('extNames', () => {
	it('lists the registered native extensions, sorted', () => {
		const buf = Buffer.from('\0zlib.so\0enc/utf_16le.so\0digest/sha2.so\0not a.so\0', 'latin1');
		expect(extNames(buf)).toEqual(['digest/sha2', 'enc/utf_16le', 'zlib']);
	});
});

describe('the command', () => {
	const dir = mkdtempSync(join(tmpdir(), 'check-binary-'));
	afterAll(() => rmSync(dir, { recursive: true, force: true }));
	const run = (...args: string[]) =>
		spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
	const clean = join(dir, 'clean.wasm');
	const full = join(dir, 'full.wasm');
	writeFileSync(clean, wasm({ functions: ['main'], data: ['hello\0'] }));
	writeFileSync(full, wasm({ functions: ['ossl_raise'], data: ALL_DATA }));

	it('exits 0 for a clean binary and 1 for one with OpenSSL', () => {
		expect(run(clean).status).toBe(0);
		const r = run(clean, full);
		expect(r.status).toBe(1);
		expect(r.stdout).toContain('FAIL: OpenSSL marker banner found');
	});

	it('with --expect-openssl, exits 0 only when every marker is there', () => {
		expect(run(full, '--expect-openssl').status).toBe(0);
		const r = run(clean, '--expect-openssl');
		expect(r.status).toBe(1);
		expect(r.stdout).toContain('FAIL: expected OpenSSL marker data:OPENSSLDIR, not found');
	});

	// npm ci installs the stock interpreter (package-lock.json); the gate must see all of OpenSSL in
	// it, stripped and debug, or it cannot be trusted to see none in the new build.
	it.runIf(existsSync(`${STOCK}/ruby.debug+stdlib.wasm`))(
		'finds every marker in the stock binaries',
		() => {
			const r = run(
				`${STOCK}/ruby+stdlib.wasm`,
				`${STOCK}/ruby.debug+stdlib.wasm`,
				'--expect-openssl',
			);
			expect(r.stdout).toContain('ok: all 7 OpenSSL markers present, as expected');
			expect(r.stdout).toContain('ok: all 8 OpenSSL markers present, as expected');
			expect(r.status).toBe(0);
		},
		60_000,
	);
});
