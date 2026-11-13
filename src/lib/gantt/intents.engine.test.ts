// SPDX-License-Identifier: GPL-2.0-or-later
// Gantt actions still schedule (phase-2.md 7.1, 11.2): each 7.1 row's edit of the
// gantt-manipulation fixture is scheduled by the wasm engine in Node (engine/golden/run-wasm.mjs)
// and compared with the fixture as it is: `ok` stays true, no new error or fatal message ids
// appear, and the edit has the effect the gesture showed (a resized bar ends at the snapped end, a
// moved bar starts the dragged number of working days later). Then random actions keep the first
// two properties, apart from errors that depend on the schedule and not on the text (11.2), which
// are counted. Needs the built engine (npm run build:engine); skipped without it, except with
// TJP_EDIT_ENGINE=1, where a missing engine fails.
import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import type { NodeEngine } from '../../engine/runtime';
import type { ScheduleResult, TaskScenarioResult } from '../../engine/protocol';
import { bootNodeEngine } from '../../../engine/golden/run-wasm.mjs';
import { ROOT } from '../../../tests/grammar/corpus';
import { finishScenario } from '../schedule/finish';
import { workingTimeOf } from '../schedule/working-time';
import { checkAction, type GanttAction, type MoveKind } from './intents';
import { actionArb, fixtureFrom, manipulation, type Fixture } from './intents-testing';

const ENGINE = path.join(ROOT, 'public/engine/manifest.json');
const REQUIRED = process.env['TJP_EDIT_ENGINE'] === '1';
const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };
const RUNS = Number(process.env['GANTT_ENGINE_RUNS'] ?? 60);
const START = Date.UTC(2026, 2, 2);
const at = (date: string, hour: number): number =>
	(Date.parse(`${date}T00:00:00Z`) - START) / 60_000 + hour * 60;

let engine: NodeEngine;
let revision = 0;
const fx = manipulation();

function schedule(files: Record<string, string>): ScheduleResult {
	return engine.schedule({ files, entry: fx.snap.entry, revision: ++revision, options: {} });
}

const errorIds = (r: ScheduleResult): string[] =>
	r.messages
		.filter((m) => m.level === 'error' || m.level === 'fatal')
		.map((m) => `${m.level}:${m.id}`)
		.sort();

/** New error ids of `after` against `before` (multiset difference). */
function newErrors(before: ScheduleResult, after: ScheduleResult): string[] {
	const left = errorIds(before);
	return errorIds(after).filter((id) => {
		const i = left.indexOf(id);
		if (i < 0) return true;
		left.splice(i, 1);
		return false;
	});
}

const original = (): Record<string, string> =>
	Object.fromEntries([...fx.snap.files.keys()].map((p) => [p, fx.text(p)]));

/** The files after an action on `f`, or null when it gives no edit. */
function edited(f: Fixture, a: GanttAction, move: MoveKind | null): Record<string, string> | null {
	const out = checkAction(a, f.ctx({ move: move === null ? null : { kind: move } }), f.snap);
	if (out.status !== 'edit') return null;
	const files: Record<string, string> = {};
	for (const [p, file] of f.snap.files) {
		const cs = out.edit.changes[p];
		files[p] = cs ? cs.apply(file.text).toString() : file.text.toString();
	}
	return files;
}

function taskIn(r: ScheduleResult, id: string): TaskScenarioResult {
	const scenario = finishScenario(r) ?? 'plan';
	const s = r.tasks.find((t) => t.id === id)?.scenarios[scenario];
	if (!s) throw new Error(`no ${id} in the result`);
	return s;
}

/** One 7.1 row: the action, the move preference, and what the engine must show after it. */
interface Row {
	readonly row: string;
	readonly action: GanttAction;
	readonly move?: MoveKind;
	readonly check?: (after: ScheduleResult, before: ScheduleResult) => void;
}

/** The task's work ends (or starts) on that calendar day (UTC fixture). */
const endsOn = (id: string, day: string) => (r: ScheduleResult) =>
	expect(Math.floor(((taskIn(r, id).end as number) - 1) / 1440)).toBe(at(day, 0) / 1440);
const startsOn = (id: string, day: string) => (r: ScheduleResult) =>
	expect(Math.floor((taskIn(r, id).start as number) / 1440)).toBe(at(day, 0) / 1440);
const endsAt = (id: string, end: number) => (r: ScheduleResult) =>
	expect(taskIn(r, id).end).toBe(end);
const startsAt = (id: string, start: number) => (r: ScheduleResult) =>
	expect(taskIn(r, id).start).toBe(start);
/** The task starts `days` working days of working time later than before. */
const later = (id: string, days: number) => (after: ScheduleResult, before: ScheduleResult) => {
	const p = before.project;
	if (!p) throw new Error('no project');
	const wt = workingTimeOf(p);
	const a = taskIn(before, id).start as number;
	const b = taskIn(after, id).start as number;
	expect(wt.workingBetween(wt.snap(a, 'start'), wt.snap(b, 'start'))).toBe(days * 8 * 60);
};

function linkOf(pred: string, succ: string): (typeof fx.links)[number] {
	const l = fx.links.find((x) => x.pred === pred && x.succ === succ);
	if (!l) throw new Error(`no link ${pred} > ${succ}`);
	return l;
}

const ROWS: readonly Row[] = [
	{
		row: 'R1 effort',
		action: { type: 'resize', task: 'design.research', at: at('2026-03-06', 17) },
		check: endsAt('design.research', at('2026-03-06', 17)),
	},
	{
		row: 'R1 effort, two people (L1)',
		action: { type: 'resize', task: 'build.code', at: at('2026-04-03', 17) },
		check: endsOn('build.code', '2026-04-03'),
	},
	{
		row: 'R1 ALAP effort, start handle (M2)',
		action: { type: 'resize', task: 'design.docs', at: at('2026-03-23', 9) },
		check: (r) => {
			startsOn('design.docs', '2026-03-23')(r);
			endsAt('design.docs', at('2026-03-26', 17))(r);
		},
	},
	{
		row: 'R1 length',
		action: { type: 'resize', task: 'design.sketch', at: at('2026-03-13', 17) },
		check: endsAt('design.sketch', at('2026-03-13', 17)),
	},
	{
		row: 'R1 duration',
		action: { type: 'resize', task: 'design.review', at: at('2026-03-09', 17) },
		check: endsAt('design.review', at('2026-03-09', 17)),
	},
	{
		row: 'R1 start and end, ALAP start handle',
		action: { type: 'resize', task: 'launch', at: at('2026-04-30', 9) },
		check: startsAt('launch', at('2026-04-30', 0)),
	},
	{ row: 'R1 open-ended', action: { type: 'resize', task: 'spike', at: at('2026-03-27', 17) } },
	{
		row: 'R1 step',
		action: { type: 'size-step', task: 'design.research', steps: 1 },
		check: endsAt('design.research', at('2026-03-05', 17)),
	},
	{
		row: 'R2 start',
		action: { type: 'move', task: 'design.research', days: 5 },
		move: 'start',
		check: startsAt('design.research', at('2026-03-09', 9)),
	},
	{
		row: 'R2 gap',
		action: { type: 'move', task: 'design.sketch', days: 1 },
		move: 'gap',
		check: later('design.sketch', 1),
	},
	{
		row: 'R2 gap on a plain depends',
		action: { type: 'move', task: 'support.hotfix', days: 2 },
		move: 'gap',
		check: later('support.hotfix', 2),
	},
	{
		row: 'R2 gap cleared',
		action: { type: 'move', task: 'design.sketch', days: -2 },
		move: 'gap',
		check: later('design.sketch', -2),
	},
	{
		row: 'R2 ALAP end',
		action: { type: 'move', task: 'design.docs', days: 1 },
		move: 'start',
		check: endsAt('design.docs', at('2026-03-27', 17)),
	},
	{ row: 'R3 insert', action: { type: 'link', pred: 'design.research', succ: 'launch' } },
	{
		row: 'R3 append sibling',
		action: { type: 'link', pred: 'design.research', succ: 'design.review' },
	},
	{
		row: 'R3 append absolute',
		action: { type: 'link', pred: 'design.sketch', succ: 'support.hotfix' },
	},
	{
		row: 'R4 whole line',
		action: { type: 'unlink', link: linkOf('design.docs', 'design.gate') },
		check: (r) =>
			expect(taskIn(r, 'design.gate').depends.map((d) => d.task)).toEqual(['design.review']),
	},
	{
		row: 'R4 plain depends',
		action: { type: 'unlink', link: linkOf('design.gate', 'support.hotfix') },
		check: (r) => expect(taskIn(r, 'support.hotfix').depends).toEqual([]),
	},
	{ row: 'R5 reparent', action: { type: 'reorder', task: 'launch', parent: 'support', index: 1 } },
	{
		row: 'R5 reparent with references',
		action: { type: 'reorder', task: 'design.sketch', parent: null, index: 0 },
	},
	{ row: 'R6 append', action: { type: 'assign', task: 'design.research', resource: 'dev2' } },
	{ row: 'R6 insert', action: { type: 'assign', task: 'design.review', resource: 'dev3' } },
	{ row: 'R6 remove', action: { type: 'unassign', task: 'design.docs', resource: 'dev2' } },
	{
		row: 'R7',
		action: { type: 'replace-person', task: 'design.research', from: 'dev1', to: 'dev3' },
	},
	{
		row: 'R8',
		action: { type: 'rename', task: 'build.code', name: 'Implement' },
		check: (r) => expect(r.tasks.find((t) => t.id === 'build.code')?.name).toBe('Implement'),
	},
	{
		row: 'R9 rewrite',
		action: { type: 'progress', task: 'design.research', percent: 43 },
		check: (r) => expect(taskIn(r, 'design.research').complete).toBe(45),
	},
	{
		row: 'R9 insert',
		action: { type: 'progress', task: 'design.sketch', percent: 40 },
		check: (r) => expect(taskIn(r, 'design.sketch').complete).toBe(40),
	},
	{
		row: 'add',
		action: { type: 'add', parent: 'design', index: 5, name: 'Spec review' },
		check: (r) => expect(r.tasks.some((t) => t.id === 'design.spec_review')).toBe(true),
	},
	{
		row: 'delete',
		action: { type: 'delete', task: 'design.docs' },
		check: (r) => expect(r.tasks.some((t) => t.id === 'design.docs')).toBe(false),
	},
	{ row: 'delete top level', action: { type: 'delete', task: 'launch' } },
];

/**
 * Errors that say the edited plan no longer fits its constraints, not that the text is wrong
 * (11.2: the edit API does not refuse schedule-dependent errors; the dispatcher reports them).
 */
const TOLERATED = new Set([
	'error:sched_runaway',
	'error:not_scheduled',
	'error:impossible_end_dep',
	'error:impossible_start_dep',
	'error:task_pred_before',
	'error:task_succ_after',
	'error:effort_no_allocations',
	'error:task_underspecified',
	'error:task_overspecified',
	'error:container_end_before_child',
	'error:container_start_after_child',
]);

describe.skipIf(!REQUIRED && !fs.existsSync(ENGINE))('Gantt actions schedule', () => {
	let base: ScheduleResult;

	beforeAll(async () => {
		engine = (await bootNodeEngine({ log: () => {} })) as NodeEngine;
		base = schedule(original());
	}, 120_000);

	it('the fixture schedules as its golden says', () => {
		expect(base.ok).toBe(true);
		expect(errorIds(base)).toEqual([]);
		expect(taskIn(base, 'design.sketch').start).toBe(taskIn(fx.result, 'design.sketch').start);
	});

	for (const r of ROWS) {
		it(`${r.row}: ${r.action.type} schedules, with no new errors`, () => {
			const files = edited(fx, r.action, r.move ?? null);
			expect(files, r.row).not.toBeNull();
			const after = schedule(files as Record<string, string>);
			const msgs = after.messages.filter((m) => m.level === 'error' || m.level === 'fatal');
			expect(after.ok, `${r.row} ${JSON.stringify(msgs)}`).toBe(true);
			expect(newErrors(base, after), r.row).toEqual([]);
			r.check?.(after, base);
		});
	}

	it('random actions schedule, apart from schedule-dependent errors (counted)', () => {
		let edits = 0;
		let tolerated = 0;
		fc.assert(
			fc.property(actionArb(fx), fc.constantFrom<MoveKind | null>('start', 'gap'), (a, m) => {
				const files = edited(fx, a, m);
				if (!files) return;
				edits++;
				const after = schedule(files);
				const added = newErrors(base, after);
				if (added.length > 0 && added.every((id) => TOLERATED.has(id))) {
					tolerated++;
					return;
				}
				const msgs = after.messages.filter((x) => x.level === 'error' || x.level === 'fatal');
				expect(added, `${JSON.stringify(a)} ${JSON.stringify(msgs)}`).toEqual([]);
				expect(after.ok, JSON.stringify(a)).toBe(true);
			}),
			{ numRuns: RUNS, ...SEED },
		);
		console.info(
			`gantt actions on the engine: ${edits} edits, ${tolerated} with schedule-dependent errors`,
		);
		expect(edits).toBeGreaterThan(RUNS / 4);
	}, 300_000);

	it('a re-planned action on the edited plan still schedules (two drags in a row)', () => {
		const once = edited(fx, { type: 'move', task: 'design.research', days: 2 }, 'start');
		expect(once).not.toBeNull();
		const r1 = schedule(once as Record<string, string>);
		const f2 = fixtureFrom(once as Record<string, string>, fx.snap.entry, r1);
		const twice = edited(f2, { type: 'move', task: 'design.research', days: 1 }, 'start');
		expect(twice?.['plan.tjp']).toContain('    start 2026-03-05\n');
		const r2 = schedule(twice as Record<string, string>);
		expect(r2.ok).toBe(true);
		expect(taskIn(r2, 'design.research').start).toBe(at('2026-03-05', 9));
	});
});
