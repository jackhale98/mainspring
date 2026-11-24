// SPDX-License-Identifier: GPL-2.0-or-later
// The codec (phase-4.md 6.2, 13.1, 18.11): bytes to text as ADR-0002 #13 decodes them, text to
// bytes as UTF-8, and the round-trip law over arbitrary bytes and strings (fast-check; FC_SEED
// replays a run, FC_RUNS sets how many).
import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { INVALID_UTF8_FILE, ROOT, goldenPlans } from '../../../tests/roundtrip/corpus';
import { decodePlanFile, decodeSnapshot, encodeFiles, encodePlanFile, lossyChanged } from './codec';
import { createLocalStore } from './local-store';
import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';

const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };
const RUNS = Number(process.env['FC_RUNS'] ?? 2000);
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const bytes = (...b: number[]): Uint8Array => new Uint8Array(b);

/** Strings of plan-like text: every code point, and BOM, CR, LF, CRLF and astral ones often. */
const planText = fc
	.array(
		fc.oneof(
			{ arbitrary: fc.string({ unit: 'binary' }), weight: 4 },
			{ arbitrary: fc.constantFrom('﻿', '\r', '\n', '\r\n', '\u{1F600}', 'é', '�'), weight: 3 },
		),
	)
	.map((parts) => parts.join(''));

// 2,000-case properties and the whole golden corpus through a store: about 1.5 s alone, past
// the 5 s default on a loaded machine (timeouts seen on 2026-11-23 and 24, never a wrong result).
const SLOW = 30_000;

describe('decodePlanFile and encodePlanFile', () => {
	it('keeps a BOM, CRLF, a lone CR and astral characters, byte for byte', () => {
		for (const s of [
			'﻿project p "P" 2026-01-05 +1m\r\n',
			'a\rb\r\n\n',
			'task \u{1F680} "é"\n',
			'',
		]) {
			const b = utf8(s);
			expect(decodePlanFile(b)).toEqual({ text: s, lossy: false });
			expect(encodePlanFile(s)).toEqual(b);
		}
		// Exactly one BOM is the bridge's to drop (ADR-0002 #13): the codec keeps both.
		expect(decodePlanFile(bytes(0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x61)).text).toBe('﻿﻿a');
	});

	it('replaces invalid sequences with U+FFFD and says so', () => {
		expect(decodePlanFile(bytes(0x61, 0xff, 0x62))).toEqual({ text: 'a�b', lossy: true });
		// A truncated sequence at the end, an overlong form and a lone surrogate's bytes.
		expect(decodePlanFile(bytes(0x61, 0xe2, 0x82)).lossy).toBe(true);
		expect(decodePlanFile(bytes(0xc0, 0xaf)).lossy).toBe(true);
		expect(decodePlanFile(bytes(0xed, 0xa0, 0x80)).lossy).toBe(true);
		// A real U+FFFD in valid UTF-8 is not lossy.
		expect(decodePlanFile(utf8('�'))).toEqual({ text: '�', lossy: false });
	});

	it(
		'round-trips every byte string that is not lossy, byte for byte (property)',
		() => {
			fc.assert(
				fc.property(fc.uint8Array({ maxLength: 64 }), (b) => {
					const d = decodePlanFile(b);
					if (!d.lossy) expect(encodePlanFile(d.text)).toEqual(b);
					// A lossy file decodes the same way every time, and its text is valid to store.
					else
						expect(decodePlanFile(encodePlanFile(d.text))).toEqual({ text: d.text, lossy: false });
				}),
				{ numRuns: RUNS, ...SEED },
			);
		},
		SLOW,
	);

	it(
		'round-trips the bytes of every well-formed string (property)',
		() => {
			fc.assert(
				fc.property(planText, (s) => {
					const b = encodePlanFile(s);
					expect(decodePlanFile(b)).toEqual({ text: s, lossy: false });
					expect(encodePlanFile(decodePlanFile(b).text)).toEqual(b);
				}),
				{ numRuns: RUNS, ...SEED },
			);
		},
		SLOW,
	);

	it(
		'marks lossy exactly the bytes a strict decoder refuses (property)',
		() => {
			fc.assert(
				fc.property(fc.uint8Array({ maxLength: 32 }), (b) => {
					let strict = true;
					try {
						new TextDecoder('utf-8', { fatal: true }).decode(b);
					} catch {
						strict = false;
					}
					expect(decodePlanFile(b).lossy).toBe(!strict);
				}),
				{ numRuns: RUNS, ...SEED },
			);
		},
		SLOW,
	);
});

describe('snapshots and the lossy flag (18.11)', () => {
	it('decodes a snapshot and flags its files that were not valid UTF-8', () => {
		const d = decodeSnapshot({
			revision: 'r1',
			files: new Map([
				['plan.tjp', utf8('project p "P" 2026-01-05 +1m\n')],
				['bad.tji', bytes(0x61, 0xff)],
			]),
		});
		expect(d.revision).toBe('r1');
		expect(d.files.get('bad.tji')).toBe('a�');
		expect([...d.lossy]).toEqual(['bad.tji']);
		expect(encodeFiles(d.files).get('plan.tjp')).toEqual(utf8('project p "P" 2026-01-05 +1m\n'));
	});

	it('names a lossy file only once its text changed: an unchanged one is never written', () => {
		const read = decodeSnapshot({
			revision: 'r1',
			files: new Map([
				['a.tji', bytes(0x61, 0xff)],
				['b.tji', bytes(0x62, 0xff)],
				['c.tji', utf8('c')],
			]),
		});
		const now = new Map(read.files);
		expect(lossyChanged(read, now)).toEqual([]);
		now.set('b.tji', 'b� edited');
		now.set('c.tji', 'c edited');
		expect(lossyChanged(read, now)).toEqual(['b.tji']);
		// A file the text does not have (not in this write) is not named.
		now.delete('b.tji');
		expect(lossyChanged(read, now)).toEqual([]);
	});
});

describe('the golden corpus through the browser store (13.1)', () => {
	it(
		'stores and reads back every golden file with identical bytes, and the invalid one as text',
		async () => {
			const s = createLocalStore({ indexedDB: new IDBFactory(), marker: null });
			let compared = 0;
			for (const plan of goldenPlans()) {
				const raw = new Map(
					plan.files.map((f) => [
						f,
						new Uint8Array(fs.readFileSync(path.join(ROOT, plan.root, f))),
					]),
				);
				const read = decodeSnapshot({ revision: plan.id, files: raw });
				const id = await s.create(
					{
						name: plan.id,
						entry: plan.entry,
						location: { kind: 'browser' },
						from: { opened: true },
					},
					read.files,
					null,
				);
				const back = (await s.open(id))?.files ?? new Map<string, string>();
				for (const [f, b] of raw) {
					const file = `${plan.root}/${f}`;
					const text = back.get(f) ?? '';
					expect(text, file).toBe(read.files.get(f));
					if (file === INVALID_UTF8_FILE) {
						expect(read.lossy.has(f), file).toBe(true);
						expect(lossyChanged(read, back), file).toEqual([]);
					} else {
						expect(read.lossy.has(f), file).toBe(false);
						expect(encodePlanFile(text), file).toEqual(b);
					}
					compared++;
				}
			}
			expect(compared).toBeGreaterThanOrEqual(80);
		},
		SLOW,
	);
});
