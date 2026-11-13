// SPDX-License-Identifier: GPL-2.0-or-later
// The rows of phase-2.md 7.1 on the gantt-manipulation fixture (tests/fixtures/gantt/manipulation)
// with its committed golden result: each action goes through planAction and a dry run of the edit
// API (checkAction), and the files after it must equal the expected text. Every expected text is
// written by hand from the spec's "Text change" column and the 7.2 layout rules (statement order
// `start, end, ..., effort|duration|length, depends, precedes, allocate, complete`, then child
// tasks), as a replacement of exact original lines; none is copied from the module's output.
// Over 400 lines on purpose: the whole 7.1 table stays in one file, row by row, so its coverage
// can be read against the spec in one place.
//
// Dates: the project starts Monday 2026-03-02 00:00 UTC; working time is Monday to Friday,
// 09:00 to 17:00 (the default). `at('2026-03-06', 17)` is Friday 6 March at 17:00 in minutes.
import { describe, expect, it } from 'vitest';
import { checkAction, planAction, resizeEdge, type GanttAction } from './intents';
import { brief, filesAfter, manipulation, patched } from './intents-testing';

const fx = manipulation();
const PLAN = 'plan.tjp';
const BUILD = 'lib/build.tji';
const plan = fx.text(PLAN);
const build = fx.text(BUILD);
const START = Date.UTC(2026, 2, 2);
const at = (date: string, hour: number): number =>
	(Date.parse(`${date}T00:00:00Z`) - START) / 60_000 + hour * 60;

/** The files after the action must be the originals with exactly these files replaced. */
function expectFiles(
	a: GanttAction,
	expected: Record<string, string>,
	move: 'start' | 'gap' | null = null,
): void {
	const files = filesAfter(fx, a, { move: move === null ? null : { kind: move } });
	expect(files).toEqual({
		...Object.fromEntries([...fx.snap.files.keys()].map((p) => [p, fx.text(p)])),
		...expected,
	});
}

function refusal(a: GanttAction, move: 'start' | 'gap' | null = null): unknown {
	const out = checkAction(a, fx.ctx({ move: move === null ? null : { kind: move } }), fx.snap);
	return out.status === 'refused' ? out.reason : brief(out);
}

describe('R1 change effort or length (resize)', () => {
	it('scales an effort by the span and rounds to whole written units ("about")', () => {
		// research: effort 3d over Mon 2 to Wed 4 March; the end dragged to Fri 6 March 17:00.
		const a: GanttAction = { type: 'resize', task: 'design.research', at: at('2026-03-06', 17) };
		expectFiles(a, { [PLAN]: patched(plan, '    effort 3d\n', '    effort 5d\n') });
		const p = planAction(a, fx.ctx());
		expect(p.status === 'intent' && p.label.approx).toBe(true);
	});

	it('scales an effort shared by two people (code, 6d over 27 working hours)', () => {
		// To Fri 3 April 17:00: 48 working hours, 6d x 48 / 27 = 10.7d. The whole day that keeps
		// the end on Friday (L1): 10d burns 27 h x 10 / 6 = 45 working hours, to Fri 14:00; 11d
		// would run 49.5 h, into Monday. (dev2 at 0.8 and dev3: 80 h / 1.8 = 44.4 h, Friday too.)
		const a: GanttAction = { type: 'resize', task: 'build.code', at: at('2026-04-03', 17) };
		expectFiles(a, { [BUILD]: patched(build, '    effort 6d\n', '    effort 10d\n') });
	});

	it('sets a length to the working time from the start to the snapped end', () => {
		// sketch starts Fri 6 March 17:00; to Fri 13 March 17:00 is five working days.
		const a: GanttAction = { type: 'resize', task: 'design.sketch', at: at('2026-03-13', 17) };
		expectFiles(a, { [PLAN]: patched(plan, '    length 4d\n', '    length 5d\n') });
	});

	it('sets a duration to the calendar time', () => {
		// review starts Fri 6 March 17:00; to Mon 9 March 17:00 is three calendar days.
		const a: GanttAction = { type: 'resize', task: 'design.review', at: at('2026-03-09', 17) };
		expectFiles(a, { [PLAN]: patched(plan, '    duration 2d\n', '    duration 3d\n') });
	});

	it('rewrites the dragged edge of a task with its own start and end (ALAP: the start)', () => {
		// launch says `end` after `start`, so it is ALAP: its handle is the start (M2). Dragged to
		// Thu 30 April 09:00, the day's first working minute, written as that date.
		const a: GanttAction = { type: 'resize', task: 'launch', at: at('2026-04-30', 9) };
		expectFiles(a, { [PLAN]: patched(plan, '  start 2026-05-04\n', '  start 2026-04-30\n') });
		expect(resizeEdge('launch', fx.ctx())).toBe('start');
		expect(resizeEdge('design.research', fx.ctx())).toBe('end');
		expect(resizeEdge('design.gate', fx.ctx())).toBeNull();
	});

	it('ALAP: the start handle grows the size, the end stays (M2)', () => {
		// docs: ALAP, effort 2d for dev1 and dev2, Wed 25 March 16:00 to Thu 26 March 17:00 (9
		// working hours). Dragged to Mon 23 March 09:00: 32 working hours, 2d x 32 / 9 = 7.1d; 7d
		// burns 9 x 7 / 2 = 31.5 h back from Thursday 17:00, which starts on Monday.
		const a: GanttAction = { type: 'resize', task: 'design.docs', at: at('2026-03-23', 9) };
		expectFiles(a, {
			[PLAN]: patched(
				plan,
				'    effort 2d\n    allocate dev1, dev2\n',
				'    effort 7d\n    allocate dev1, dev2\n',
			),
		});
	});

	it('inserts an effort into an open-ended allocated leaf (11.1), after start by 7.2 order', () => {
		// spike: start Mon 23 March, dev3; to Fri 27 March 17:00 is five working days, one person.
		const a: GanttAction = { type: 'resize', task: 'spike', at: at('2026-03-27', 17) };
		expectFiles(a, {
			[PLAN]: patched(
				plan,
				'  start 2026-03-23\n  allocate dev3\n',
				'  start 2026-03-23\n  effort 5d\n  allocate dev3\n',
			),
		});
	});

	it('steps the size by one written unit (Shift+Alt+Right/Left)', () => {
		expectFiles(
			{ type: 'size-step', task: 'design.research', steps: 1 },
			{ [PLAN]: patched(plan, '    effort 3d\n', '    effort 4d\n') },
		);
		expectFiles(
			{ type: 'size-step', task: 'design.sketch', steps: -1 },
			{ [PLAN]: patched(plan, '    length 4d\n', '    length 3d\n') },
		);
	});

	it('has no handle on milestones, containers and macro-built tasks', () => {
		expect(refusal({ type: 'resize', task: 'design.gate', at: at('2026-04-01', 17) })).toBe(
			'milestone',
		);
		expect(refusal({ type: 'resize', task: 'design', at: at('2026-04-01', 17) })).toBe('container');
		expect(refusal({ type: 'resize', task: 'build.check_unit', at: at('2026-04-20', 17) })).toBe(
			'text-only',
		);
	});
});

describe('R2 move a task (move preference)', () => {
	it('asks once, pre-selecting gap when a written dependency drives the task, else start', () => {
		expect(planAction({ type: 'move', task: 'design.sketch', days: 1 }, fx.ctx())).toEqual({
			status: 'ask-move-preference',
			suggested: 'gap',
		});
		expect(planAction({ type: 'move', task: 'design.research', days: 1 }, fx.ctx())).toEqual({
			status: 'ask-move-preference',
			suggested: 'start',
		});
	});

	it('start: inserts `start` at its rank (before effort) for an ASAP task, as a constraint', () => {
		// research starts Mon 2 March 09:00; five working days later is Mon 9 March.
		const a: GanttAction = { type: 'move', task: 'design.research', days: 5 };
		expectFiles(
			a,
			{
				[PLAN]: patched(
					plan,
					'    effort 3d\n    allocate dev1\n',
					'    start 2026-03-09\n    effort 3d\n    allocate dev1\n',
				),
			},
			'start',
		);
		const p = planAction(a, fx.ctx({ move: { kind: 'start' } }));
		expect(p.status === 'intent' && p.constraint).toBe(true);
	});

	it('gap: the driving gaplength grows by the days moved', () => {
		expectFiles(
			{ type: 'move', task: 'design.sketch', days: 1 },
			{
				[PLAN]: patched(
					plan,
					'depends !research { gaplength 2d }',
					'depends !research { gaplength 3d }',
				),
			},
			'gap',
		);
	});

	it('gap: a plain depends gets a body with the gap', () => {
		expectFiles(
			{ type: 'move', task: 'support.hotfix', days: 2 },
			{
				[PLAN]: patched(
					plan,
					'    depends design.gate\n',
					'    depends design.gate { gaplength 2d }\n',
				),
			},
			'gap',
		);
	});

	it('gap: a container moves by the gap of its own driving dependency', () => {
		// build's own `depends design.gate` drives it. Its body holds `${checkTask "unit"}`, a
		// statement-level call that declares a task with a depends, so the edit API refuses with
		// macro-in-body (7.1 R1/R2 notes: the edit API's refusals come through), at the call.
		const a: GanttAction = { type: 'move', task: 'build', days: 1 };
		expect(planAction(a, fx.ctx({ move: { kind: 'gap' } }))).toMatchObject({
			status: 'intent',
			intent: {
				type: 'setDependsGap',
				task: 'build',
				target: 'design.gate',
				gap: { kind: 'gaplength', value: '1d' },
			},
		});
		const out = checkAction(a, fx.ctx({ move: { kind: 'gap' } }), fx.snap);
		expect(out).toMatchObject({ status: 'refused', reason: 'macro-in-body' });
		const call = out.status === 'refused' ? out.at[0] : undefined;
		expect(call && build.slice(call.from, call.to)).toBe('${checkTask "unit"}');
		expect(refusal({ type: 'move', task: 'build', days: 1 }, 'start')).toBe('container');
	});

	it('gap: moving back to the predecessor clears the gap; further is at the limit', () => {
		expectFiles(
			{ type: 'move', task: 'design.sketch', days: -2 },
			{ [PLAN]: patched(plan, 'depends !research { gaplength 2d }', 'depends !research') },
			'gap',
		);
		expect(refusal({ type: 'move', task: 'support.hotfix', days: -1 }, 'gap')).toBe('at-limit');
	});

	it('gap without a driver writes start; an explicit gap there is no-driver', () => {
		const a: GanttAction = { type: 'move', task: 'design.research', days: 5 };
		expectFiles(
			a,
			{
				[PLAN]: patched(
					plan,
					'    effort 3d\n    allocate dev1\n',
					'    start 2026-03-09\n    effort 3d\n    allocate dev1\n',
				),
			},
			'gap',
		);
		expect(refusal({ ...a, kind: 'gap' }, 'start')).toBe('no-driver');
	});

	it('ALAP: rewrites `end` whatever the preference (19.2)', () => {
		// docs ends Thu 26 March 17:00 (`end 2026-03-27`); one working day later ends Friday 27.
		for (const move of ['start', 'gap', null] as const) {
			expectFiles(
				{ type: 'move', task: 'design.docs', days: 1 },
				{ [PLAN]: patched(plan, '    end 2026-03-27\n', '    end 2026-03-28\n') },
				move,
			);
		}
	});

	it('cannot move a task with its own start and end, or past its dependencies', () => {
		expect(refusal({ type: 'move', task: 'launch', days: 1 }, 'start')).toBe('start-and-end');
		// sketch already starts where research and the gap put it.
		expect(refusal({ type: 'move', task: 'design.sketch', days: -3 }, 'start')).toBe('at-limit');
		expect(refusal({ type: 'move', task: 'design.research', days: -1 }, 'start')).toBe('at-limit');
		expect(refusal({ type: 'move', task: 'build.check_unit', days: 1 }, 'start')).toBe('text-only');
	});
});

describe('R3 link tasks', () => {
	it('inserts `depends` with an absolute id for a non-sibling, after responsible by 7.2 order', () => {
		expectFiles(
			{ type: 'link', pred: 'design.research', succ: 'launch' },
			{
				[PLAN]: patched(
					plan,
					'  responsible dev1\n',
					'  responsible dev1\n  depends design.research\n',
				),
			},
		);
	});

	it('appends to the last own depends: `, !sibling` or an absolute id', () => {
		expectFiles(
			{ type: 'link', pred: 'design.research', succ: 'design.review' },
			{
				[PLAN]: patched(
					plan,
					'depends !sketch { onstart }',
					'depends !sketch { onstart }, !research',
				),
			},
		);
		expectFiles(
			{ type: 'link', pred: 'design.sketch', succ: 'support.hotfix' },
			{
				[PLAN]: patched(
					plan,
					'    depends design.gate\n',
					'    depends design.gate, design.sketch\n',
				),
			},
		);
	});

	it('surfaces cycle, already-linked and conflicting-attribute', () => {
		expect(refusal({ type: 'link', pred: 'design.research', succ: 'design.research' })).toBe(
			'cycle',
		);
		expect(refusal({ type: 'link', pred: 'design', succ: 'design.research' })).toBe('cycle');
		expect(refusal({ type: 'link', pred: 'design.gate', succ: 'design.research' })).toBe('cycle');
		// docs says `scheduling alap`: a depends would turn it ASAP.
		expect(refusal({ type: 'link', pred: 'design.review', succ: 'design.docs' })).toBe(
			'conflicting-attribute',
		);
		expect(refusal({ type: 'link', pred: 'design.research', succ: 'design.sketch' })).toMatchObject(
			{
				status: 'noop',
				reason: 'already-linked',
			},
		);
	});
});

describe('R4 remove a link', () => {
	const linkOf = (pred: string, succ: string) => {
		const l = fx.links.find((x) => x.pred === pred && x.succ === succ);
		if (!l) throw new Error(`no link ${pred} > ${succ}`);
		return l;
	};

	it('removes the whole depends line when it was the only item', () => {
		expectFiles(
			{ type: 'unlink', link: linkOf('design.docs', 'design.gate') },
			{ [PLAN]: patched(plan, '    depends !docs\n', '') },
		);
	});

	it('removes a dependency written on a container, unless a macro call is in its body', () => {
		// The line design.gate > build stands for build's children too (links.ts); its site is
		// build's own depends. build's body has `${checkTask "unit"}`: macro-in-body.
		const a: GanttAction = { type: 'unlink', link: linkOf('design.gate', 'build') };
		expect(planAction(a, fx.ctx())).toMatchObject({
			intent: { type: 'removeDepends', task: 'build', target: 'design.gate' },
		});
		expect(refusal(a)).toBe('macro-in-body');
		expectFiles(
			{ type: 'unlink', link: linkOf('design.gate', 'support.hotfix') },
			{ [PLAN]: patched(plan, '    depends design.gate\n', '') },
		);
	});

	it('refuses a line only a macro writes (engine-only)', () => {
		expect(refusal({ type: 'unlink', link: linkOf('build.tests', 'build.check_unit') })).toBe(
			'engine-only',
		);
	});
});

describe('R5 reorder or reparent', () => {
	it('reparents a block with its comment, re-indented, after the last sibling', () => {
		const block =
			'# Start and end on one task, and a responsible person.\ntask launch "Launch" {\n  start 2026-05-04\n  end 2026-05-08\n  responsible dev1\n}\n\n';
		const moved =
			'  # Start and end on one task, and a responsible person.\n  task launch "Launch" {\n    start 2026-05-04\n    end 2026-05-08\n    responsible dev1\n  }\n';
		const expected = patched(
			patched(plan, block, ''),
			'    depends design.gate\n  }\n}\n',
			`    depends design.gate\n  }\n${moved}}\n`,
		);
		expectFiles(
			{ type: 'reorder', task: 'launch', parent: 'support', index: 1 },
			{ [PLAN]: expected },
		);
	});

	it('fixes references both ways when a task leaves its parent', () => {
		// sketch to the top, first: its `!research` becomes absolute, review's `!sketch` too.
		const block =
			'  task sketch "Sketch" {\n    length 4d\n    allocate dev2\n    depends !research { gaplength 2d }\n  }\n';
		const top =
			'task sketch "Sketch" {\n  length 4d\n  allocate dev2\n  depends design.research { gaplength 2d }\n}\n\n';
		let expected = patched(plan, block, '');
		expected = patched(expected, 'depends !sketch { onstart }', 'depends sketch { onstart }');
		expected = patched(
			expected,
			'# Container with ASAP leaves',
			`${top}# Container with ASAP leaves`,
		);
		expectFiles(
			{ type: 'reorder', task: 'design.sketch', parent: null, index: 0 },
			{ [PLAN]: expected },
		);
	});

	it('surfaces cycle and unfixable-reference', () => {
		expect(refusal({ type: 'reorder', task: 'design', parent: 'design.research', index: 0 })).toBe(
			'cycle',
		);
		// check_unit's macro body says `depends !tests`.
		expect(refusal({ type: 'reorder', task: 'build.tests', parent: null, index: 0 })).toBe(
			'unfixable-reference',
		);
	});
});

describe('R6 assign a person, R7 replace one', () => {
	it('appends to the allocate list, or inserts one by 7.2 order', () => {
		expectFiles(
			{ type: 'assign', task: 'design.research', resource: 'dev2' },
			{
				[PLAN]: patched(
					plan,
					'    allocate dev1\n    complete 40\n',
					'    allocate dev1, dev2\n    complete 40\n',
				),
			},
		);
		expectFiles(
			{ type: 'assign', task: 'design.review', resource: 'dev3' },
			{
				[PLAN]: patched(
					plan,
					'    depends !sketch { onstart }\n',
					'    depends !sketch { onstart }\n    allocate dev3\n',
				),
			},
		);
	});

	it('removes one person from a list', () => {
		expectFiles(
			{ type: 'unassign', task: 'design.docs', resource: 'dev2' },
			{ [PLAN]: patched(plan, '    allocate dev1, dev2\n', '    allocate dev1\n') },
		);
	});

	it('surfaces conflicting-attribute and inherited', () => {
		// research's effort needs someone.
		expect(refusal({ type: 'unassign', task: 'design.research', resource: 'dev1' })).toBe(
			'conflicting-attribute',
		);
		expect(refusal({ type: 'unassign', task: 'support.hotfix', resource: 'ops1' })).toBe(
			'inherited',
		);
	});

	it('R7 replaces one id token', () => {
		expectFiles(
			{ type: 'replace-person', task: 'design.research', from: 'dev1', to: 'dev3' },
			{
				[PLAN]: patched(
					plan,
					'    allocate dev1\n    complete 40\n',
					'    allocate dev3\n    complete 40\n',
				),
			},
		);
	});
});

describe('R8 rename, R9 progress, add and delete', () => {
	it('R8 rewrites the name string only', () => {
		expectFiles(
			{ type: 'rename', task: 'build.code', name: 'Implement' },
			{ [BUILD]: patched(build, 'task code "Write code"', 'task code "Implement"') },
		);
		expect(refusal({ type: 'rename', task: 'build.code', name: 'Use ${x}' })).toBe('unsafe-text');
	});

	it('R9 snaps to 5 % and rewrites or inserts complete (leaves only)', () => {
		expectFiles(
			{ type: 'progress', task: 'design.research', percent: 43 },
			{ [PLAN]: patched(plan, '    complete 40\n', '    complete 45\n') },
		);
		expectFiles(
			{ type: 'progress', task: 'design.sketch', percent: 40 },
			{
				[PLAN]: patched(
					plan,
					'    depends !research { gaplength 2d }\n',
					'    depends !research { gaplength 2d }\n    complete 40\n',
				),
			},
		);
		expect(refusal({ type: 'progress', task: 'design', percent: 50 })).toBe('container');
		expect(refusal({ type: 'progress', task: 'design.gate', percent: 50 })).toBe('milestone');
	});

	it('adds a task after the last child, its id from the name', () => {
		expectFiles(
			{ type: 'add', parent: 'design', index: 5, name: 'Spec review' },
			{
				[PLAN]: patched(
					plan,
					'    depends !docs\n  }\n}\n',
					'    depends !docs\n  }\n  task spec_review "Spec review"\n}\n',
				),
			},
		);
	});

	it('deletes a block and the depends items naming it', () => {
		const docs =
			'  task docs "Write docs" {\n    scheduling alap\n    end 2026-03-27\n    effort 2d\n    allocate dev1, dev2\n  }\n';
		expectFiles(
			{ type: 'delete', task: 'design.docs' },
			{ [PLAN]: patched(patched(plan, docs, ''), '    depends !docs\n', '') },
		);
	});

	it('deletes a top-level block with its comment and one of the blank lines around it', () => {
		const launch =
			'# Start and end on one task, and a responsible person.\ntask launch "Launch" {\n  start 2026-05-04\n  end 2026-05-08\n  responsible dev1\n}\n\n';
		expectFiles({ type: 'delete', task: 'launch' }, { [PLAN]: patched(plan, launch, '') });
	});
});
