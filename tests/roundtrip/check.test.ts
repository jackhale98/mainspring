// SPDX-License-Identifier: GPL-2.0-or-later
// The checker itself: it must fail when the bytes, the tree or the error expectation disagree.
import { describe, expect, it } from 'vitest';
import { createFile } from '../../src/lib/tjp/document';
import { checkFile, decode, firstDifference } from './check';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const meta = { corpus: 'test', plan: 'p', file: 'p/plan.tjp' };
const PLAN = 'project p "P" 2024-01-01 +1m {}\ntask a "A" {\n\teffort 2d\n}\n';

describe('checkFile', () => {
	it('passes a valid file byte for byte', () => {
		const b = enc(PLAN);
		const row = checkFile(meta, b, createFile('plan.tjp', decode(b)), null, false);
		expect(row.problems).toEqual([]);
		expect(row.comparison).toBe('bytes');
		expect(row.typedStatements).toBeGreaterThan(2);
		expect(row.valuesChecked).toBe(1);
	});

	it('fails when the file bytes differ from what the tree prints', () => {
		const b = enc(PLAN);
		const other = createFile('plan.tjp', PLAN.replace('2d', '3d'));
		const row = checkFile(meta, b, other, null, false);
		expect(row.problems.join('\n')).toMatch(/workspace text differs/);
	});

	it('keeps a BOM and CRLF', () => {
		const b = enc(`\uFEFF${PLAN.replace(/\n/g, '\r\n')}`);
		expect(checkFile(meta, b, createFile('plan.tjp', decode(b)), null, false).problems).toEqual([]);
	});

	it('reports error nodes in a file that must have none, and the wrong error line', () => {
		const b = enc('task a "A" {\n\teffort @\n}\n');
		const f = createFile('plan.tjp', decode(b));
		expect(checkFile(meta, b, f, null, false).problems.join()).toMatch(/error node/);
		expect(checkFile(meta, b, f, 2, false).problems).toEqual([]);
		expect(checkFile(meta, b, f, 7, false).problems.join()).toMatch(/expected 7/);
	});

	it('compares invalid UTF-8 as text, and only if it really is invalid', () => {
		const bad = new Uint8Array([...enc('task a "A\u00e9'), 0xff, ...enc('" {}\n')]);
		const row = checkFile(meta, bad, createFile('plan.tjp', decode(bad)), null, true);
		expect(row.problems).toEqual([]);
		expect(row.comparison).toBe('text');
		const good = enc(PLAN);
		expect(checkFile(meta, good, createFile('plan.tjp', PLAN), null, true).problems.join()).toMatch(
			/U\+FFFD/,
		);
	});

	it('firstDifference finds the byte and length differences', () => {
		expect(firstDifference(enc('abc'), enc('abc'))).toBe(-1);
		expect(firstDifference(enc('abc'), enc('abd'))).toBe(2);
		expect(firstDifference(enc('ab'), enc('abc'))).toBe(2);
	});
});
