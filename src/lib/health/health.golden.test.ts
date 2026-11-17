// SPDX-License-Identifier: GPL-2.0-or-later
// The gate of phase-3.md 16.2 on the recorded engine results: every check H1 to H9 finds exactly
// its own finding on its fail fixture (the one the fixture's header names) and nothing at all on
// its pass fixture, with every check on. Then the thresholds and the switches on the same
// fixtures (18.8), and fedora-res: the counts per check, and two findings checked by hand against
// the text and the bookings.
import { describe, expect, it } from 'vitest';
import { checkPlan } from './report';
import { goldenInput, goldenReport, only } from './testing';
import { sentenceOf } from './text';
import { CHECK_IDS, DEFAULT_HEALTH_SETTINGS, type CheckId, type Finding } from './types';

const PAIRS: ReadonlyArray<readonly [CheckId, string, Partial<Finding>]> = [
	['no-predecessor', 'h1', { subject: { kind: 'task', id: 'build' } }],
	['no-successor', 'h2', { subject: { kind: 'task', id: 'test' } }],
	['hard-constraint', 'h3', { subject: { kind: 'task', id: 'build' }, severity: 'info' }],
	['constraint-warning', 'h4', { subject: { kind: 'message', index: 0 } }],
	['long-gap', 'h5', { subject: { kind: 'link', pred: 'build', succ: 'test' } }],
	['long-task', 'h6', { subject: { kind: 'task', id: 'build' }, severity: 'info' }],
	['held-by-people', 'h7', { subject: { kind: 'task', id: 'side' } }],
	['work-without-people', 'h8', { subject: { kind: 'task', id: 'side' } }],
	['resource-warning', 'h9', { subject: { kind: 'message', index: 0 } }],
];

/** The facts each fail fixture's header describes. */
const FACTS: Record<CheckId, unknown> = {
	'no-predecessor': null,
	'no-successor': null,
	// "start 2026-01-05": the project start, minute 0.
	'hard-constraint': { attr: 'start', date: 0, from: null },
	// Starts 2026-01-08 09:00, must be before 2026-01-07 00:00: Wednesday is the one working day.
	'constraint-warning': {
		limit: 'maxstart',
		days: 1,
		task: 'test',
		text: 'The start time (2026-01-08-09:00-+0000) of task test is too late. Must be before 2026-01-07-00:00-+0000.',
	},
	'long-gap': { gap: 'gaplength', days: 6 },
	'long-task': { days: 21 },
	// Kick allows 01-05; Dev is on Build 01-05 to 01-07, so Side starts 01-08: three working days.
	'held-by-people': { resource: 'dev', days: 3, on: 'build' },
	// Dev is on Build 01-05 to 01-07: three days of eight hours.
	'work-without-people': { resource: 'dev', minutes: 3 * 8 * 60 },
	'resource-warning': {
		message: 'allocate_no_assigned',
		task: 'side',
		tasks: [],
		text: "Task side has resource allocation requested, but did not get any resources assigned. Either use 'effort' to ensure allocations or use a higher 'priority'.",
	},
};

describe('health checks on their fixtures (16.2)', () => {
	it.each(PAIRS)('%s: one finding on fail, none on pass', (check, h, expected) => {
		const fail = goldenReport(`health-${h}-fail`);
		expect(fail.findings).toHaveLength(1);
		const [f] = fail.findings;
		expect(f).toMatchObject({ check, severity: 'warning', ...expected });
		expect(f?.facts).toEqual(FACTS[check]);
		expect(fail.counts).toEqual(Object.fromEntries(CHECK_IDS.map((c) => [c, c === check ? 1 : 0])));
		const pass = goldenReport(`health-${h}-pass`);
		expect(pass.findings).toEqual([]);
	});

	it('points each fail finding at its place in the text', () => {
		for (const [, h] of PAIRS) {
			const i = goldenInput(`health-${h}-fail`);
			const [f] = checkPlan(i).findings;
			expect(f?.at?.file).toBe('plan.tjp');
		}
		// H4 and H9 at the line the message names: the task's declaration header.
		const h4 = goldenInput('health-h4-fail');
		expect(checkPlan(h4).findings[0]?.at).toEqual(h4.index.tasks.get('test')?.decl.header);
		// H5 at the dependency item, H3 at the statement.
		const h5 = goldenInput('health-h5-fail');
		expect(checkPlan(h5).findings[0]?.at).toEqual(
			h5.index.dependencies.find((d) => d.succ === 'test')?.item,
		);
		const h3 = goldenInput('health-h3-fail');
		expect(checkPlan(h3).findings[0]?.at).toEqual(
			h3.index.tasks.get('build')?.attrs.find((a) => a.keyword === 'start')?.statement,
		);
	});

	it('gives each fail finding its fixes, enabled on plain text', () => {
		const kinds = (h: string) =>
			goldenReport(`health-${h}-fail`).findings[0]?.fixes.map((x) => [x.kind, x.disabled]);
		expect(kinds('h1')).toEqual([['pick', null]]);
		expect(kinds('h2')).toEqual([['pick', null]]);
		expect(kinds('h3')).toEqual([
			['intent', null],
			['why', null],
		]);
		expect(kinds('h4')).toEqual([
			['show', null],
			['why', null],
		]);
		expect(kinds('h5')).toEqual([
			['intent', null],
			['intent', null],
		]);
		expect(kinds('h6')).toEqual([['show', null]]);
		expect(kinds('h7')).toEqual([
			['replace-person', null],
			['open', null],
			['why', null],
		]);
		expect(kinds('h8')).toEqual([
			['replace-person', null],
			['open', null],
		]);
		expect(kinds('h9')).toEqual([
			['show', null],
			['replace-person', null],
		]);
		const h5 = goldenReport('health-h5-fail').findings[0];
		expect(h5?.fixes.map((x) => (x.kind === 'intent' ? x.intent : null))).toEqual([
			{ type: 'gapToTask', task: 'test', target: 'build', name: 'Wait after Build' },
			{
				type: 'setDependsGap',
				task: 'test',
				target: 'build',
				gap: { kind: 'gaplength', value: '6d' },
			},
		]);
		const h7 = goldenReport('health-h7-fail').findings[0];
		expect(h7?.fixes[0]).toEqual({
			kind: 'replace-person',
			task: 'side',
			from: 'dev',
			disabled: null,
		});
		// Open in Workload at the start of the wait (Kickoff's end, Mon 01-05 00:00), not at the
		// task's start (Thu 01-08 09:00).
		expect(h7?.fixes[1]).toMatchObject({ kind: 'open', resource: 'dev', at: 0 });
	});

	it('says each fail finding in a sentence', () => {
		const said = PAIRS.map(([, h]) => {
			const i = goldenInput(`health-${h}-fail`);
			const f = checkPlan(i).findings[0] as Finding;
			return sentenceOf(f, { index: i.index, result: i.result, locale: 'en-GB' });
		});
		expect(said).toEqual([
			'Nothing comes before it, so only the project start sets when it starts.',
			'Nothing comes after it, so no other task waits for it to end.',
			'Its start is fixed at 5 Jan 2026.',
			'Starts 1 working day after its latest allowed start.',
			'Waits 6 working days after Build.',
			'Runs for 21 working days. A long task hides how far along it is.',
			'Waits 3 working days for Dev (booked on Build).',
			'Runs without Dev for 24 hours, while Dev works on other tasks.',
			'Side work asked for people but got none. Without an effort, it books them only when they happen to be free.',
		]);
	});
});

describe('settings on the fixtures (18.8)', () => {
	it('turns a check off per plan', () => {
		for (const [check, h] of PAIRS) {
			const enabled = { ...DEFAULT_HEALTH_SETTINGS.enabled, [check]: false };
			const r = goldenReport(`health-${h}-fail`, { ...DEFAULT_HEALTH_SETTINGS, enabled });
			expect(r.findings).toEqual([]);
			expect(r.counts[check]).toBe(0);
		}
	});

	it('moves the long-gap and long-task thresholds', () => {
		const gap = (longGapDays: number) =>
			goldenReport('health-h5-fail', { ...only('long-gap'), longGapDays }).counts['long-gap'];
		expect([gap(5), gap(5.9), gap(6), gap(7)]).toEqual([1, 1, 0, 0]);
		expect(
			goldenReport('health-h5-pass', { ...only('long-gap'), longGapDays: 4 }).counts['long-gap'],
		).toBe(1);
		const task = (longTaskDays: number) =>
			goldenReport('health-h6-fail', { ...only('long-task'), longTaskDays }).counts['long-task'];
		expect([task(20), task(21), task(30)]).toEqual([1, 0, 0]);
		expect(
			goldenReport('health-h6-pass', { ...only('long-task'), longTaskDays: 19 }).counts[
				'long-task'
			],
		).toBe(1);
	});

	it('exempts the start and finish milestones only (H1, H2)', () => {
		// h1-pass: "kick" is at the project start; h2-pass: "done" ends at the finish.
		expect(goldenReport('health-h1-pass', only('no-predecessor')).findings).toEqual([]);
		expect(goldenReport('health-h2-pass', only('no-successor')).findings).toEqual([]);
		// h1-fail has no kickoff: "build" is not a milestone, so it is not exempt; h2-fail likewise.
		expect(
			goldenReport('health-h1-fail', only('no-predecessor')).findings.map((f) => f.subject),
		).toEqual([{ kind: 'task', id: 'build' }]);
	});
});

describe('fedora-res', () => {
	const i = goldenInput('fedora-res');
	const r = checkPlan(i);
	const c = { index: i.index, result: i.result, locale: 'en-GB' };

	it('has these counts per check', () => {
		expect(r.counts).toEqual({
			'no-predecessor': 48,
			'no-successor': 200,
			'hard-constraint': 380,
			'constraint-warning': 0,
			'long-gap': 39,
			'long-task': 10,
			'held-by-people': 0,
			'work-without-people': 77,
			'resource-warning': 21,
		});
		// Only the shown scenario's messages: fedora-res warns allocate_no_assigned in both.
		const shown = i.result.messages.filter(
			(m) => m.id === 'allocate_no_assigned' && m.scenario === i.analysis.scenario,
		);
		expect(r.counts['resource-warning']).toBe(shown.length);
		// Every H3 is a `start`: most leaves inherit the root's `start ${start_work}` (or a phase's
		// macro start), a date the index cannot read, so "Remove" is disabled as `macro-call`.
		const h3 = new Map<string, number>();
		for (const f of r.findings) {
			if (f.check !== 'hard-constraint') continue;
			const key = [f.facts.attr, f.facts.from, f.facts.date, f.fixes[0]?.disabled].join(' ');
			h3.set(key, (h3.get(key) ?? 0) + 1);
		}
		expect(Object.fromEntries(h3)).toEqual({
			'start f20  macro-call': 246,
			'start f20.TestingPhase.alpha  macro-call': 107,
			'start f20.DevelopmentPhase  macro-call': 2,
			'start f20.elections 211920 ': 18,
			'start f20.naming 201840 ': 5,
			'start  21840 ': 1,
			'start  42000 ': 1,
		});
	});

	it('spot check 1: H5 on clean_market_wiki, 25 working days after start_features_cal', () => {
		const f = r.findings.find(
			(x) =>
				x.check === 'long-gap' &&
				x.subject.kind === 'link' &&
				x.subject.succ === 'f20.PlanningPhase.clean_market_wiki',
		);
		// f-20.tjp: `depends !start_features_cal { gaplength 25d }` on the task.
		expect(f?.facts).toEqual({ gap: 'gaplength', days: 25 });
		const dep = i.result.tasks
			.find((t) => t.id === 'f20.PlanningPhase.clean_market_wiki')
			?.scenarios[i.analysis.scenario]?.depends.find(
				(d) => d.task === 'f20.PlanningPhase.start_features_cal',
			);
		expect(dep?.gapLengthMin).toBe(25 * 8 * 60);
		expect(sentenceOf(f as Finding, c)).toBe(
			'Waits 25 working days after Start Feature Submission.',
		);
	});

	it('spot check 2: H8 on supplement_license_review, 56 hours without Desktop 01', () => {
		const id = 'f20.supplement_wallpaper.supplement_license_review';
		const f = r.findings.find(
			(x) => x.check === 'work-without-people' && x.subject.kind === 'task' && x.subject.id === id,
		);
		expect(f?.facts).toEqual({ resource: 'desk01', minutes: 3360 });
		// By hand from the bookings: in the task's span, Desktop 01's slots booked on other tasks
		// and not on this one, inside their working time.
		const s = i.result.tasks.find((t) => t.id === id)?.scenarios[i.analysis.scenario];
		const res = i.result.project?.timingResolutionMin ?? 60;
		const mine = new Set<number>();
		const other = new Set<number>();
		for (const b of i.result.bookings) {
			if (b.resource !== 'desk01' || b.scenario !== i.analysis.scenario) continue;
			for (const [a, e] of b.intervals)
				for (let m = a; m < e; m += res) (b.task === id ? mine : other).add(m);
		}
		let slots = 0;
		for (let m = s?.start ?? 0; m < (s?.end ?? 0); m += res)
			if (other.has(m) && !mine.has(m)) slots++;
		expect(slots * res).toBe(3360);
		expect(sentenceOf(f as Finding, c)).toBe(
			'Runs without Desktop 01 for 56 hours, while Desktop 01 works on other tasks.',
		);
	});
});
