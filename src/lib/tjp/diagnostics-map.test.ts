// SPDX-License-Identifier: GPL-2.0-or-later
// Stale positions (phase-1.md 6.6 step 4): engine diagnostics mapped through later edits, and
// properties that no mapping or refinement gives a position outside the text.
import type { ChangeSet, Text } from '@codemirror/state';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { EngineMessage, ScheduleResult } from '../../engine/protocol';
import { changeSetOf, textOf } from './document';
import { engineDiagnostics, mapDiagnostics, mapRange, type TjpDiagnostic } from './diagnostics';
import { RULES } from './diagnostics-refine';
import { buildIndex } from './index';
import { golden, inline } from './index/testing';

function result(messages: EngineMessage[]): ScheduleResult {
	return {
		revision: 3,
		ok: false,
		project: null,
		tasks: [],
		resources: [],
		bookings: [],
		messages,
		timings: { writeFsMs: 0, parseMs: 0, scheduleMs: 0, serializeMs: 0, totalMs: 0 },
	};
}

const msg = (over: Partial<EngineMessage>): EngineMessage => ({
	level: 'error',
	id: 'no_reduce',
	text: "Unexpected token 'colour' found. Expecting '}'",
	file: 'plan.tjp',
	line: 1,
	column: null,
	scenario: null,
	...over,
});

describe('mapDiagnostics', () => {
	const ws = golden('bridge-parse-failure');
	const sent = ws.snapshot();
	const before = engineDiagnostics(
		result([msg({ line: 14 }), msg({ file: null, line: null, id: 'x', text: 'x' })]),
		sent,
	);
	const plan = () => ws.state('plan.tjp').doc;
	const current = (p: string): Text | null => (p === 'plan.tjp' ? plan() : null);

	it('follows insertions before the range and recomputes line and column', () => {
		const at = before[0]?.from ?? 0;
		ws.commit(
			'plan.tjp',
			ws.state('plan.tjp').update({
				changes: [
					{ from: 0, insert: '# new\n' },
					{ from: at, insert: '  ' },
				],
			}),
			'typing',
		);
		const after = mapDiagnostics(before, ws.changesSince(sent.version), current);
		const d = after[0];
		expect(d && plan().sliceString(d.from, d.to)).toBe('colour');
		expect(d && [d.line, d.column, d.stale]).toEqual([15, 5, true]);
		expect(after[1]).toMatchObject({ precision: 'none', line: null, stale: true });
	});

	it('collapses a deleted range to a point', () => {
		const doc = plan();
		const at = doc.toString().indexOf('colour');
		ws.commit(
			'plan.tjp',
			ws.state('plan.tjp').update({ changes: { from: at - 1, to: at + 7 } }),
			'typing',
		);
		const [d] = mapDiagnostics(before, ws.changesSince(sent.version), current);
		// The kept indentation space sits at at - 2, the deletion started at at - 1.
		expect(d && d.from === d.to && d.from >= at - 2 && d.from <= at - 1).toBe(true);
	});

	it('returns the list unchanged when nothing changed', () => {
		expect(mapDiagnostics(before, new Map(), current)).toBe(before);
	});

	it('keeps positions without line numbers when the current text does not match', () => {
		const cs = changeSetOf({ from: 0, insert: 'x' }, sent.files.get('plan.tjp')?.text.length ?? 0);
		const [d] = mapDiagnostics(before, new Map([['plan.tjp', cs]]), () => null);
		expect(d && [d.line, d.column, d.stale]).toEqual([null, null, true]);
	});
});

const PIECES = [
	'task t "T" {',
	'}',
	'\n',
	'\r\n',
	'\r',
	'  ',
	'effort 2d',
	'colour',
	'"s',
	'#c',
	'${m}',
	'é',
];

const docArb = fc.array(fc.constantFrom(...PIECES), { maxLength: 30 }).map((p) => p.join(''));

function changesArb(length: number): fc.Arbitrary<ChangeSet> {
	return fc
		.array(fc.tuple(fc.nat(length), fc.nat(length), fc.constantFrom('', 'x', '\n', '  ab')), {
			maxLength: 4,
		})
		.map((edits) => {
			const specs = edits
				.map(([a, b, insert]) => ({ from: Math.min(a, b), to: Math.max(a, b), insert }))
				.sort((x, y) => x.from - y.from);
			const disjoint: typeof specs = [];
			for (const s of specs) {
				const last = disjoint[disjoint.length - 1];
				if (!last || s.from > last.to) disjoint.push(s);
			}
			return changeSetOf(disjoint, length);
		});
}

describe('properties', () => {
	it('mapping never produces a position outside the new text', () => {
		fc.assert(
			fc.property(
				docArb.chain((text) =>
					fc.tuple(
						fc.constant(text),
						changesArb(text.length),
						fc.array(fc.tuple(fc.nat(text.length), fc.nat(8))),
					),
				),
				([text, cs, ranges]) => {
					const doc = textOf(text);
					const next = cs.apply(doc);
					const list: TjpDiagnostic[] = ranges.map(([from, len]) => ({
						file: 'plan.tjp',
						from,
						to: Math.min(text.length, from + len),
						severity: 'error',
						source: 'engine',
						messageId: 'x',
						message: 'x',
						hint: null,
						scenario: null,
						precision: 'token',
						line: 1,
						column: 1,
						revision: 1,
						stale: false,
					}));
					for (const d of mapDiagnostics(list, new Map([['plan.tjp', cs]]), () => next)) {
						expect(d.from).toBeGreaterThanOrEqual(0);
						expect(d.from).toBeLessThanOrEqual(d.to);
						expect(d.to).toBeLessThanOrEqual(next.length);
						if (!cs.empty) expect(d.line).toBeGreaterThanOrEqual(1);
					}
					for (const [from, len] of ranges) {
						const r = mapRange(from - 4, from + len + 4, cs);
						expect(0 <= r.from && r.from <= r.to && r.to <= cs.newLength).toBe(true);
					}
				},
			),
		);
	});

	it('engine messages on any line, with any rule, land inside the file', () => {
		const ids = [...Object.keys(RULES), 'unknown_id'];
		fc.assert(
			fc.property(
				docArb,
				fc.array(
					fc.record({
						id: fc.constantFrom(...ids),
						line: fc.integer({ min: -2, max: 40 }),
						text: fc.constantFrom(
							"Unexpected token 'colour' found",
							"Unexpected token '<END>' found",
							'Task t has unknown depends x',
							'The end time (x) of task t is too late.',
							'Overwriting a previously provided value for attribute effort',
							'Redefining macro m',
							'  ${m}',
							"Unexpected characters found: '  \"s...'",
							'',
						),
					}),
					{ maxLength: 6 },
				),
				(text, ms) => {
					const s = inline({ 'plan.tjp': text }).snapshot();
					const ds = engineDiagnostics(result(ms.map((m) => msg(m))), s, buildIndex(s));
					expect(ds).toHaveLength(ms.length);
					for (const d of ds) {
						expect(0 <= d.from && d.from <= d.to && d.to <= text.length).toBe(true);
					}
				},
			),
		);
	});
});
