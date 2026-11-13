// SPDX-License-Identifier: GPL-2.0-or-later
// Properties of planAction and checkAction (phase-2.md 6.6, 7.1, 13.1) over random Gantt actions on
// the gantt-manipulation fixture, and of the dates they write across DST (syn-09, Berlin):
//
// 1. Total: planAction never throws and returns one of its statuses; checkAction refuses only with
//    a known reason and always with a sentence.
// 2. An edit is minimal and safe: its inverse restores every file byte for byte, it adds no syntax
//    error, the index rebuilds, and the target task is still there (unless the action deletes it
//    or moves it to a new id).
// 3. A start written by a move is where the move put it: read back by TaskJuggler's date rules, it
//    snaps to the same working minute as the shifted engine start, unless the dependencies clamp it.
// 4. Resizing further never makes a size smaller.
// 5. writeDate: across DST, a written start or end reads back to the same working minute.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ProjectInfo } from '../../engine/protocol';
import { createTimeZoneHost } from '../../engine/timezone';
import { workingTimeOf } from '../schedule/working-time';
import { ganttActionStrings } from '../strings';
import { buildIndex } from '../tjp/index';
import { syntaxIssues } from '../tjp/tree';
import { dateEpoch, parseDate } from '../tjp/values/date';
import type { ZoneOffsets } from '../tjp/values/civil';
import { createWorkspace, type WorkspaceSnapshot } from '../workspace/workspace';
import { checkAction, earliestStart, planAction, type MoveKind } from './intents';
import { scenarioOf } from './intents-facts';
import { actionArb, goldenResult, manipulation } from './intents-testing';
import { writeDate } from './intents-time';

const RUNS = Number(process.env['GANTT_INTENT_RUNS'] ?? 200);
const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };
const fx = manipulation();
const TASKS = [...fx.index.tasks.keys()];
const action = actionArb(fx);
const move = fc.constantFrom<MoveKind | null>(null, 'start', 'gap');

const issues = (snap: WorkspaceSnapshot): number =>
	[...snap.files.values()].reduce((n, f) => n + syntaxIssues(f.tree, f.text).length, 0);
const BASE_ISSUES = issues(fx.snap);

function readBack(text: string, p: ProjectInfo, zones?: ZoneOffsets): number | null {
	const d = parseDate(text);
	if (!d.ok || d.value.kind !== 'date') return null;
	const e = dateEpoch(d.value.date, { zone: p.timezone, ...(zones ? { zones } : {}) });
	return e.ok ? Math.round((e.value - Date.parse(p.start) / 1000) / 60) : null;
}

describe('Gantt actions on the manipulation fixture', () => {
	it('plan totally and edit minimally and safely', () => {
		const tally = new Map<string, number>();
		fc.assert(
			fc.property(action, move, (a, m) => {
				const ctx = fx.ctx({ move: m === null ? null : { kind: m } });
				const planned = planAction(a, ctx);
				expect(['intent', 'ask-move-preference', 'not-possible']).toContain(planned.status);
				const out = checkAction(a, ctx, fx.snap);
				const key = `${a.type} ${out.status}${out.status === 'refused' ? ` ${out.reason}` : ''}`;
				tally.set(key, (tally.get(key) ?? 0) + 1);
				if (out.status === 'refused') {
					expect(out.message.length).toBeGreaterThan(0);
					return;
				}
				if (out.status === 'noop') {
					expect(out.message).toBe(ganttActionStrings.noop[out.reason]);
					return;
				}
				if (out.status !== 'edit') return;
				const files: Record<string, string> = {};
				for (const [p, f] of fx.snap.files) {
					const cs = out.edit.changes[p];
					files[p] = cs ? cs.apply(f.text).toString() : f.text.toString();
					if (cs) {
						const inv = out.edit.inverse[p];
						expect(inv?.apply(cs.apply(f.text)).toString()).toBe(f.text.toString());
					}
				}
				const next = createWorkspace({ entry: fx.snap.entry, files }).snapshot();
				expect(issues(next)).toBeLessThanOrEqual(BASE_ISSUES);
				const index = buildIndex(next, undefined, { cache: null });
				const i = out.intent;
				// Rebuilt without engine hints: only ids the text names are checked.
				const named = 'task' in i ? fx.index.tasks.get(i.task)?.idSource === 'text' : false;
				if ('task' in i && named && i.type !== 'deleteTask' && i.type !== 'moveTask') {
					expect(index.tasks.has(i.task)).toBe(true);
				}
			}),
			// At least 600: a reorder is valid about one time in seven, and every kind must reach an edit.
			{ numRuns: Math.max(RUNS, 600), ...SEED },
		);
		// The generator reaches edits of every kind, not only refusals.
		for (const t of ['resize', 'move', 'link', 'reorder', 'assign', 'progress', 'add', 'delete']) {
			expect(tally.get(`${t} edit`) ?? 0, `${t} ${JSON.stringify([...tally])}`).toBeGreaterThan(0);
		}
	}, 60_000);

	it('move a task by the asked working days, unless its dependencies clamp it', () => {
		const ctx = fx.ctx({ move: { kind: 'start' } });
		const wt = ctx.wt;
		const project = fx.result.project;
		if (!wt || !project) throw new Error('fixture has no schedule');
		// An oracle that does not use shiftDays: the fixture is in UTC and starts at midnight, so
		// day d is [d * 1440, (d + 1) * 1440); it is a working day when it holds working time.
		const working = (d: number): boolean => wt.workingBetween(d * 1440, (d + 1) * 1440) > 0;
		const count = (from: number, to: number): number => {
			let n = 0;
			for (let d = Math.min(from, to) + 1; d <= Math.max(from, to); d++) if (working(d)) n++;
			return to >= from ? n : -n;
		};
		/** The day of a working start, and of the last working minute before an end. */
		const startDay = (m: number): number => Math.floor(wt.snap(m, 'start') / 1440);
		const endDay = (m: number): number => Math.floor((wt.snap(m, 'end') - 1) / 1440);
		let moved = 0;
		fc.assert(
			fc.property(fc.constantFrom(...TASKS), fc.integer({ min: -10, max: 10 }), (id, days) => {
				const p = planAction({ type: 'move', task: id, days }, ctx);
				if (p.status !== 'intent' || p.intent.type !== 'setAttr') return;
				const s = scenarioOf(fx.result, id);
				if (!s || s.start === null || s.end === null) throw new Error(`no dates for ${id}`);
				const m = readBack(String(p.intent.value), project);
				expect(m).not.toBeNull();
				const at = m as number;
				moved++;
				if (p.intent.attr === 'end') {
					// ALAP: the end moves; nothing in the fixture's precedes clamps it.
					expect(count(endDay(s.end), endDay(at))).toBe(days);
					return;
				}
				expect(p.intent.attr).toBe('start');
				const n = count(startDay(s.start), startDay(at));
				const floor = earliestStart(id, ctx);
				if (n !== days) {
					// Only an earlier move stops short, exactly at what the dependencies allow.
					expect(days).toBeLessThan(n);
					expect(floor).not.toBeNull();
					expect(wt.snap(at, 'start')).toBe(wt.snap(floor as number, 'start'));
				}
			}),
			{ numRuns: RUNS, ...SEED },
		);
		expect(moved).toBeGreaterThan(0);
	});

	it('never shrink a size when the end goes further', () => {
		const ctx = fx.ctx();
		const sized = [
			'design.research',
			'design.sketch',
			'design.review',
			'build.code',
			'build.tests',
		];
		/** The written size in minutes of its unit (8-hour days, as the fixture's settings). */
		const minutes = (text: string): number => {
			const m = /^(\d+)(d|h|min)$/.exec(text);
			if (!m) throw new Error(`size ${text}`);
			return Number(m[1]) * (m[2] === 'd' ? 480 : m[2] === 'h' ? 60 : 1);
		};
		const value = (id: string, end: number): number | null => {
			const p = planAction({ type: 'resize', task: id, at: end }, ctx);
			return p.status === 'intent' && p.intent.type === 'setAttr'
				? minutes(String(p.intent.value))
				: null;
		};
		fc.assert(
			fc.property(
				fc.constantFrom(...sized),
				fc.nat({ max: 60 * 1440 }),
				fc.nat({ max: 20 * 1440 }),
				(id, a, d) => {
					const start = scenarioOf(fx.result, id)?.start ?? 0;
					const x = value(id, start + 60 + a);
					const y = value(id, start + 60 + a + d);
					if (x !== null && y !== null) expect(y).toBeGreaterThanOrEqual(x);
				},
			),
			{ numRuns: RUNS, ...SEED },
		);
	});
});

describe('writeDate across DST (syn-09, Berlin)', () => {
	const zones = createTimeZoneHost();
	const project = goldenResult('syn-09-tz-dst-berlin').project;
	if (!project) throw new Error('syn-09 has no project');
	const wt = workingTimeOf(project, zones);
	const env = { project, zones, wt };

	it('reads a written day start or end back to the same working minute', () => {
		fc.assert(
			fc.property(
				fc.nat({ max: Math.max(0, wt.frameEnd - 1) }),
				fc.boolean(),
				fc.boolean(),
				(m, isStart, exact) => {
					const role = isStart ? 'start' : 'end';
					const target = isStart ? wt.dayStart(m) : wt.dayEnd(m + 1);
					const text = writeDate(target, role, env, exact);
					if (text === null) return;
					const back = readBack(text, project, zones);
					expect(back).not.toBeNull();
					if (exact) expect(back).toBe(target);
					expect(wt.snap(back as number, role)).toBe(wt.snap(target, role));
				},
			),
			{ numRuns: RUNS * 2, ...SEED },
		);
	});
});
