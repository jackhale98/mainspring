// SPDX-License-Identifier: GPL-2.0-or-later
// Unit tests of the fidelity harness pieces: range coverage, the format region, the report, and the
// registry of families (every enforced type has a family, pending types are listed and not enforced).
import { describe, expect, it } from 'vitest';
import { HANDLERS } from '../../src/lib/tjp/edit/apply';
import { covered } from './harness';
import { ENFORCED, FAMILIES, PENDING } from './families';
import { formatAllows } from './families/format';
import type { Facts } from './gen/facts';
import { percentile, renderReport, tally, type TextPart } from './stats';

describe('covered', () => {
	it('accepts a change inside one range and across adjacent ranges', () => {
		const rs = [
			{ from: 10, to: 20 },
			{ from: 20, to: 30 },
		];
		expect(covered({ from: 12, to: 18 }, rs)).toBe(true);
		expect(covered({ from: 15, to: 25 }, rs)).toBe(true);
		expect(covered({ from: 20, to: 20 }, rs)).toBe(true);
	});
	it('rejects a change that leaves the ranges or falls in a gap', () => {
		const rs = [
			{ from: 10, to: 20 },
			{ from: 22, to: 30 },
		];
		expect(covered({ from: 15, to: 25 }, rs)).toBe(false);
		expect(covered({ from: 5, to: 8 }, rs)).toBe(false);
		expect(covered({ from: 21, to: 21 }, rs)).toBe(false);
		expect(covered({ from: 5, to: 5 }, [])).toBe(false);
	});
});

describe('the format region', () => {
	const text = 'task a "A" {\n    effort 1d  \n  /* c\n     d */\n}\n';
	const facts = {
		texts: { 'p.tjp': text },
		noTouch: [{ file: 'p.tjp', from: text.indexOf('/*'), to: text.indexOf('*/') + 2 }],
	} as unknown as Facts;
	const ch = (from: number, to: number, insert = ''): Parameters<typeof formatAllows>[0] => ({
		file: 'p.tjp',
		from,
		to,
		insert,
	});
	it('allows leading and trailing whitespace of a line', () => {
		const e = text.indexOf('effort');
		expect(formatAllows(ch(e - 4, e, '  '), facts)).toBe(true);
		const end = text.indexOf('1d') + 2;
		expect(formatAllows(ch(end, end + 2), facts)).toBe(true);
	});
	it('refuses other text, new non-blank text and lines inside a comment', () => {
		const e = text.indexOf('effort');
		expect(formatAllows(ch(e, e + 3), facts)).toBe(false);
		expect(formatAllows(ch(e - 2, e - 2, 'x'), facts)).toBe(false);
		const d = text.indexOf('d */');
		expect(formatAllows(ch(d - 5, d, '  '), facts)).toBe(false);
		const inner = text.indexOf('*/') - 3;
		expect(formatAllows(ch(inner, inner, ' '), facts)).toBe(false);
	});
});

describe('the families', () => {
	it('cover each enforced type once and leave the pending types out', () => {
		expect(new Set(ENFORCED).size).toBe(ENFORCED.length);
		for (const p of PENDING) expect(ENFORCED).not.toContain(p.type);
		expect(FAMILIES.flatMap((f) => f.types)).toEqual(ENFORCED);
	});
	it('cover every intent the edit API has a handler for, and no pending one', () => {
		const handled = Object.keys(HANDLERS);
		const known = new Set<string>([...ENFORCED, ...PENDING.map((p) => p.type)]);
		// An intent with a handler must be enforced here, or the suite does not test it.
		expect(handled.filter((t) => !ENFORCED.includes(t as never) && !known.has(t))).toEqual([]);
		expect(handled.filter((t) => PENDING.some((p) => p.type === t))).toEqual([]);
		// `format` is produced by formatFile only, so it has no handler.
		expect(ENFORCED.filter((t) => t !== 'format' && !handled.includes(t))).toEqual([]);
	});
	it('list every 7.1 intent as enforced or pending', () => {
		const all = [
			'setAttr',
			'removeAttr',
			'renameTask',
			'addTask',
			'deleteTask',
			'moveTask',
			'addDepends',
			'removeDepends',
			'setDependsGap',
			'allocate',
			'addAllocation',
			'removeAllocation',
			'replaceAllocation',
			'addResource',
			'deleteResource',
			'moveResource',
			'renameResource',
			'setResourceAttr',
			'removeResourceAttr',
			'setProjectHeader',
			'setProjectAttr',
			'removeProjectAttr',
			'setWorkingHours',
			'addLeave',
			'updateLeave',
			'removeLeave',
			'declareFlag',
			'format',
		];
		const known = new Set<string>([...ENFORCED, ...PENDING.map((p) => p.type)]);
		expect([...known].sort()).toEqual([...all].sort());
	});
});

describe('the report', () => {
	it('prints counts, pending intents and the seed', () => {
		const outcomes = [
			{ type: 'setAttr', status: 'edit', reason: null },
			{ type: 'setAttr', status: 'refused', reason: 'invalid-value' },
			{ type: 'setAttr', status: 'noop', reason: 'already-set' },
		] as never;
		const part: TextPart = {
			seed: 42,
			runs: 3,
			corpusRuns: 0,
			shard: '0/1',
			corpusBasis: 'test',
			corpusPlans: [],
			wallMs: 1000,
			p50Ms: 1,
			p95Ms: 2,
			maxMs: 3,
			perType: tally(outcomes, ['setAttr']),
			pending: [{ type: 'addTask', task: 'T11b' }],
			failures: [],
			deliberate: {},
			regressions: { replayed: 1 },
		};
		const md = renderReport(part, null, null);
		expect(md).toContain('Seed 42');
		expect(md).toContain('| setAttr | 3 | 1 | 1 | 1 | invalid-value 1, already-set 1 |');
		expect(md).toContain('| addTask | skipped, pending T11b |');
	});
	it('computes percentiles', () => {
		expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
		expect(percentile([], 0.5)).toBe(0);
	});
});
