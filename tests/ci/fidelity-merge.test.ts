// SPDX-License-Identifier: GPL-2.0-or-later
// The merge of the nightly fidelity shard reports (scripts/ci/fidelity-merge.mjs): it must fail when a shard is
// missing or repeated, when an intent type has under 5 edits over all shards, or when P4 ran on no case.
import { describe, expect, it } from 'vitest';
import { merge, render } from '../../scripts/ci/fidelity-merge.mjs';

const TYPES = ['setAttr', 'addTask'];

/** A shard report that passes every rule on its own. */
function report(shard: string, over: { edits?: number; p4Cases?: number } = {}) {
	return {
		file: `shard-${shard.split('/')[0]}/fidelity-report.json`,
		report: {
			text: {
				seed: 1,
				shard,
				wallMs: 1000,
				p95Ms: 5,
				pending: [],
				failures: [],
				deliberate: { 'text-only': 3 },
				regressions: { replayed: 4 },
				perType: TYPES.map((type) => ({
					type,
					cases: 10,
					edits: over.edits ?? 9,
					noops: 0,
					refusals: 1,
					reasons: { 'text-only': 1 },
				})),
			},
			p4: {
				runs: 20,
				cases: over.p4Cases ?? 10,
				okBefore: 10,
				okKept: 10,
				newErrors: 0,
				wallMs: 1000,
				p95Ms: 100,
				toleratedIds: { 'error:booking_no_duty': 1 },
				failures: [],
			},
			mutation: { mutants: [{ name: 'm', caught: true }] },
		},
	};
}

const four = (): ReturnType<typeof report>[] => ['0/4', '1/4', '2/4', '3/4'].map((s) => report(s));

describe('fidelity-merge', () => {
	it('passes when every shard reported once and the rules hold', () => {
		const m = merge(four(), { shards: 4 });
		expect(m.problems).toEqual([]);
		expect(m.tolerated).toEqual({ 'error:booking_no_duty': 4 });
		expect(m.replays).toBe(4);
		const text = render(m);
		expect(text).toContain('All rules hold.');
		expect(text).toContain('error:booking_no_duty 4');
		expect(text).toContain('Six in seven');
	});

	it('fails when a shard did not report', () => {
		const m = merge(four().slice(0, 3), { shards: 4 });
		expect(m.problems).toContain('shard 3/4 did not report');
		// Without --shards the count the reports name is used, so one report of four fails too.
		expect(merge([report('1/4')]).problems).toEqual(
			expect.arrayContaining(['shard 0/4 did not report', 'shard 2/4 did not report']),
		);
	});

	it('fails when a shard reported twice or the count is wrong', () => {
		const dup = [...four(), report('2/4')];
		expect(merge(dup, { shards: 4 }).problems).toContain('shard 2/4 reported 2 times');
		expect(merge(four(), { shards: 3 }).problems.join('\n')).toContain('expected 3');
	});

	it('fails when an intent type has under 5 edits over all shards', () => {
		const few = ['0/4', '1/4', '2/4', '3/4'].map((s) => report(s, { edits: 1 }));
		const m = merge(few, { shards: 4 });
		expect(m.problems.some((p) => p.startsWith('setAttr: 4 edits'))).toBe(true);
		// Five edits in all are enough, whatever shard they fall in.
		const five = [report('0/2', { edits: 5 }), report('1/2', { edits: 0 })];
		expect(merge(five, { shards: 2 }).problems).toEqual([]);
	});

	it('fails when P4 ran on no case', () => {
		const none = four();
		none[2] = report('2/4', { p4Cases: 0 });
		expect(merge(none, { shards: 4 }).problems.join('\n')).toContain('P4 ran on no case');
	});
});
