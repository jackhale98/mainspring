// SPDX-License-Identifier: GPL-2.0-or-later
// H5 and H6 (spans.ts) on hand-made results over inline text: the two gap kinds and their rates,
// the threshold, one finding per written link (not per inheriting child), both gaps, `precedes`,
// the fix intents; H6's working days, milestones, containers and its place in the text.
import { describe, expect, it } from 'vitest';
import { at, dep, plan, type TaskSpec } from '../schedule/testing';
import { checkPlan } from './report';
import { inlineInput, only } from './testing';
import { DEFAULT_HEALTH_SETTINGS } from './types';

const HEAD = 'project p "P" 2026-01-05 - 2026-03-02 {\n}\n';
const WORK_DAY = 8 * 60;
const DAY = 1440;
const TEXT = `${HEAD}task a "A" {\n}\ntask b "B" {\n  depends a { gaplength 6d }\n  length 2d\n}\n`;

function h5(tasks: Array<[string, TaskSpec]>, text = TEXT, longGapDays = 5) {
	return checkPlan(inlineInput(plan(tasks), text, { ...only('long-gap'), longGapDays })).findings;
}

const chain = (gap: {
	gapLengthMin?: number;
	gapDurationMin?: number;
}): Array<[string, TaskSpec]> => [
	['a', { start: at(0, 9), end: at(0, 17) }],
	['b', { start: at(10, 9), end: at(11, 17), depends: [dep('a', gap)] }],
];

describe('H5 long gap', () => {
	it('is over the threshold in working days (gaplength) or calendar days (gapduration)', () => {
		expect(h5(chain({ gapLengthMin: 6 * WORK_DAY })).map((f) => f.facts)).toEqual([
			{ gap: 'gaplength', days: 6 },
		]);
		expect(h5(chain({ gapLengthMin: 5 * WORK_DAY }))).toEqual([]);
		expect(h5(chain({ gapDurationMin: 6 * DAY })).map((f) => f.facts)).toEqual([
			{ gap: 'gapduration', days: 6 },
		]);
		// 5 calendar days are fewer than 5 working days would be, and still not over 5.
		expect(h5(chain({ gapDurationMin: 5 * DAY }))).toEqual([]);
		expect(h5(chain({ gapLengthMin: 6 * WORK_DAY }), TEXT, 6)).toEqual([]);
	});

	it('gives "Convert gap to task" and "Edit gap" with the gap as it stands', () => {
		const [f] = h5(chain({ gapLengthMin: 6 * WORK_DAY }));
		expect(f?.subject).toEqual({ kind: 'link', pred: 'a', succ: 'b' });
		expect(f?.fixes).toEqual([
			{
				kind: 'intent',
				label: 'Convert gap to task',
				intent: { type: 'gapToTask', task: 'b', target: 'a', name: 'Wait after A' },
				disabled: null,
			},
			{
				kind: 'intent',
				label: 'Edit gap',
				intent: {
					type: 'setDependsGap',
					task: 'b',
					target: 'a',
					gap: { kind: 'gaplength', value: '6d' },
				},
				disabled: null,
			},
		]);
		// Not whole days: in hours.
		const [g] = h5(chain({ gapDurationMin: 6 * DAY + 90 }));
		expect(g?.fixes[1]).toMatchObject({
			intent: { gap: { kind: 'gapduration', value: '145.5h' } },
		});
	});

	it('reports a container’s link once, not for each child that inherits it', () => {
		const gap = dep('a', { gapLengthMin: 10 * WORK_DAY });
		const tasks: Array<[string, TaskSpec]> = [
			['a', { start: at(0, 9), end: at(0, 17) }],
			['g', { start: at(15, 9), end: at(16, 17), depends: [gap] }],
			['g.x', { start: at(15, 9), end: at(16, 17), parent: 'g', depends: [gap] }],
			['g.y', { start: at(15, 9), end: at(16, 17), parent: 'g', depends: [gap, dep('g.x')] }],
		];
		const text = `${HEAD}task a "A" {\n}\ntask g "G" {\n  depends a { gaplength 10d }\n  task x "X" {\n  }\n  task y "Y" {\n    depends !x\n  }\n}\n`;
		expect(h5(tasks, text).map((f) => f.subject)).toEqual([{ kind: 'link', pred: 'a', succ: 'g' }]);
	});

	it('takes the longer of two gaps, without "Convert gap to task"', () => {
		const [f] = h5(chain({ gapLengthMin: 6 * WORK_DAY, gapDurationMin: 10 * DAY }));
		expect(f?.facts).toEqual({ gap: 'gapduration', days: 10 });
		expect(f?.fixes.map((x) => x.kind === 'intent' && x.intent.type)).toEqual(['setDependsGap']);
	});

	it('reports a precedes link from its owner, with "Edit gap" only', () => {
		const tasks: Array<[string, TaskSpec]> = [
			[
				'a',
				{ start: at(0, 9), end: at(0, 17), precedes: [dep('b', { gapLengthMin: 7 * WORK_DAY })] },
			],
			['b', { start: at(10, 9), end: at(11, 17) }],
		];
		const text = `${HEAD}task a "A" {\n  precedes b { gaplength 7d }\n}\ntask b "B" {\n}\n`;
		const [f] = h5(tasks, text);
		expect(f?.subject).toEqual({ kind: 'link', pred: 'a', succ: 'b' });
		expect(f?.fixes.map((x) => x.kind === 'intent' && x.intent.type)).toEqual(['setDependsGap']);
		expect(f?.at?.file).toBe('plan.tjp');
	});

	it('disables the fixes of a gap written with a macro', () => {
		const text = `macro g [gaplength 6d]\n${HEAD}task a "A" {\n}\ntask b "B" {\n  depends a { \${g} }\n}\n`;
		const [f] = h5(chain({ gapLengthMin: 6 * WORK_DAY }), text);
		expect(f?.fixes.map((x) => x.disabled)).toEqual(['macro-call', 'macro-call']);
	});
});

function h6(tasks: Array<[string, TaskSpec]>, text: string, longTaskDays = 20) {
	return checkPlan(inlineInput(plan(tasks), HEAD + text, { ...only('long-task'), longTaskDays }))
		.findings;
}

describe('H6 long task', () => {
	// Monday day 0 09:00 to Friday day 25 17:00: four weeks, 20 working days.
	const four = at(25, 17);

	it('is a leaf over the threshold in working days of the project calendar', () => {
		const text = 'task a "A" {\n  effort 21d\n}\n';
		expect(h6([['a', { start: at(0, 9), end: four }]], text)).toEqual([]);
		const [f] = h6([['a', { start: at(0, 9), end: at(28, 17) }]], text);
		expect(f?.facts).toEqual({ days: 21 });
		expect(f?.severity).toBe('info');
		expect(f?.fixes).toEqual([{ kind: 'show', disabled: null }]);
		expect(h6([['a', { start: at(0, 9), end: four }]], text, 19).map((x) => x.facts)).toEqual([
			{ days: 20 },
		]);
		// At the size statement, which is what a split would change.
		expect(f?.at?.to).toBeGreaterThan(f?.at?.from ?? 0);
	});

	it('leaves out milestones, containers and tasks without dates', () => {
		const long = { start: at(0, 9), end: at(40, 17) };
		const tasks: Array<[string, TaskSpec]> = [
			['m', { ...long, milestone: true }],
			['g', long],
			['g.x', { start: at(0, 9), end: at(1, 17), parent: 'g' }],
			['u', { start: null, end: null }],
		];
		const text = 'task m "M" {\n}\ntask g "G" {\n  task x "X" {\n  }\n}\ntask u "U" {\n}\n';
		expect(h6(tasks, text)).toEqual([]);
	});

	it('uses the plan’s own day: a 4-hour day doubles the days', () => {
		const r = checkPlan(
			inlineInput(
				plan([['a', { start: at(0, 9), end: four }]], { dailyWorkingHours: 4 }),
				`${HEAD}task a "A" {\n}\n`,
				{ ...DEFAULT_HEALTH_SETTINGS, enabled: only('long-task').enabled },
			),
		);
		expect(r.findings.map((f) => f.facts)).toEqual([{ days: 40 }]);
	});
});
