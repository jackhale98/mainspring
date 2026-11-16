// SPDX-License-Identifier: GPL-2.0-or-later
// clearLeave and gapToTask against the wasm engine (phase-3.md 6.5, 13.1), booted in Node by
// engine/golden/run-wasm.mjs:
// - gapToTask on every golden plan with gaps, for up to GAP_TASK_PER_PLAN own `depends` items with
//   one gap each (indexed with the golden's engine hints, as the app does, so Fedora 20's macro
//   ids resolve): the edit schedules with no new error or fatal message id, and on every plan
//   without resources each original task keeps its start and end in every scenario, the successor
//   included (6.5's engine test, made stronger). On plans with resources the dates are compared
//   and counted, not required.
// - clearLeave, effects on a fixture: each person works one long effort task, so the working slots
//   they are not booked are their leave. After the edit, those slots are the ones before minus the
//   scope's own leave in [start, end): a person's leave for a person, the global holiday for the
//   global scope. When the engine returns schema v3 `leaves` (T6), they are compared the same way.
// - gapToTask, the review's repros (F1 to F3): an inherited `shifts` (gaplength), a prefixed
//   `allocate` and an inherited `minstart` are refused; the same conversion written by hand moves
//   the successor, books the person or adds warnings, which is why.
// - clearLeave in Europe/Berlin (F4): `+3d` across the DST change is read as instants.
// - clearLeave, fast-check: random ranges and scopes on the fixture and on the golden plans with
//   leaves still schedule with no new errors, and on the fixture have the effect above.
// Needs the built engine (npm run build:engine); skipped without it unless TJP_EDIT_ENGINE=1.
// FC_SEED fixes the fast-check seed. Over 400 lines on purpose (CLAUDE.md): the three engine
// checks share one engine boot helper, the fixture and its leave oracle; split, each file would
// repeat them.
import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bootNodeEngine, loadCorpus, planRequest } from '../../../../engine/golden/run-wasm.mjs';
import { ROOT } from '../../../../tests/grammar/corpus';
import type { ScheduleRequest, ScheduleResult } from '../../../engine/protocol';
import { createTimeZoneHost } from '../../../engine/timezone';
import { createWorkspace } from '../../workspace/workspace';
import {
	buildIndex,
	hintsFromResult,
	type LeaveSite,
	type SourceRange,
	type SymbolIndex,
} from '../index';
import { applyIntent } from './apply';
import { textsAfter } from './testing';
import type { EditIntent, IntentOf } from './types';

const ENGINE = path.join(ROOT, 'public/engine/manifest.json');
const REQUIRED = process.env['TJP_EDIT_ENGINE'] === '1';
const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };
const RUNS = Number(process.env['LEAVE_GAP_RUNS'] ?? 24);
/** gapToTask items per golden plan (all of Fedora's); each is one engine run. */
const PER_PLAN = Number(process.env['GAP_TASK_PER_PLAN'] ?? 6);

type Engine = Awaited<ReturnType<typeof bootNodeEngine>>;
type Corpus = ReturnType<typeof loadCorpus>[number];
/** The engine's time-zone data, as the app indexes with it. */
const ZONES = createTimeZoneHost();
let revision = 0;

const errorIds = (r: ScheduleResult): string[] =>
	r.messages
		.filter((m) => m.level === 'error' || m.level === 'fatal')
		.map((m) => `${m.level}:${m.id}`)
		.sort();

/** Ids in `after` beyond the multiset of `before`. */
function newErrors(before: ScheduleResult, after: ScheduleResult): string[] {
	const left = errorIds(before);
	return errorIds(after).filter((id) => {
		const i = left.indexOf(id);
		if (i < 0) return true;
		left.splice(i, 1);
		return false;
	});
}

interface Plan {
	readonly id: string;
	readonly req: ScheduleRequest;
	readonly index: SymbolIndex;
	readonly snap: ReturnType<ReturnType<typeof createWorkspace>['snapshot']>;
}

function plan(id: string, req: ScheduleRequest, result?: ScheduleResult): Plan {
	const snap = createWorkspace({ entry: req.entry, files: req.files }).snapshot();
	const lines = (f: string): string[] => snap.files.get(f)?.text.toString().split('\n') ?? [];
	const hints = result
		? hintsFromResult(
				result,
				(_f, l) => l,
				(f, l) => lines(f)[l - 1] ?? null,
			)
		: undefined;
	return { id, req, snap, index: buildIndex(snap, hints, { cache: null, zones: ZONES }) };
}

function run(engine: Engine, p: Plan, files = p.req.files): ScheduleResult {
	return engine.schedule({ ...p.req, files, revision: ++revision });
}

/** The edited files of `intent` on `p`, or null when the intent gives no edit. */
function edited(p: Plan, intent: EditIntent): Record<string, string> | null {
	const r = applyIntent(p.snap, p.index, intent);
	return r.status === 'edit' ? textsAfter(p.snap, r) : null;
}

const dates = (r: ScheduleResult): Map<string, string> =>
	new Map(
		r.tasks.map((t) => [
			t.id,
			Object.entries(t.scenarios)
				.map(([k, v]) => `${k}:${v.start}-${v.end}`)
				.sort()
				.join(' '),
		]),
	);

describe.skipIf(!REQUIRED && !fs.existsSync(ENGINE))(
	'clearLeave and gapToTask on the engine',
	() => {
		it('gapToTask keeps every task where it was, on every plan without resources', async () => {
			const engine = await bootNodeEngine({ log: () => {} });
			let edits = 0;
			let compared = 0;
			let moved = 0;
			const failures: string[] = [];
			for (const { plan: g, golden } of loadCorpus()) {
				if (!golden.result.ok) continue;
				const p = plan(g.id, planRequest(g, golden, ++revision), golden.result);
				const all = p.index.dependencies.filter(
					(d) =>
						d.form === 'depends' &&
						d.body !== null &&
						d.succ !== null &&
						d.pred !== null &&
						/\bgap(length|duration)\b/.test(
							p.snap.files.get(d.item.file)?.text.sliceString(d.item.from, d.item.to) ?? '',
						),
				);
				if (all.length === 0) continue;
				const base = run(engine, p);
				// Up to PER_PLAN items, spread over the plan.
				const cap = PER_PLAN;
				const step = Math.max(1, Math.ceil(all.length / cap));
				const links = all.filter((_, i) => i % step === 0).slice(0, cap);
				for (const d of links) {
					const intent: IntentOf<'gapToTask'> = {
						type: 'gapToTask',
						task: d.succ as string,
						target: d.pred as string,
						name: 'Wait',
						id: 'mainspring_wait',
					};
					const files = edited(p, intent);
					if (!files) continue;
					edits++;
					const res = run(engine, p, files);
					const label = `${g.id} ${d.succ}<-${d.pred}`;
					const fresh = newErrors(base, res);
					if (!res.ok || fresh.length > 0) {
						failures.push(`${label}: ok ${res.ok}, new ${fresh.join(', ')}`);
						continue;
					}
					const before = dates(base);
					const after = dates(res);
					const changed = [...before].filter(([id, v]) => after.get(id) !== v).map(([id]) => id);
					if (base.resources.length > 0) {
						if (changed.length > 0) moved++;
						continue;
					}
					compared++;
					if (changed.length > 0)
						failures.push(`${label}: moved ${changed.slice(0, 4).join(', ')}`);
				}
			}
			console.log(`gapToTask: ${edits} edits, ${compared} compared, ${moved} moved with resources`);
			expect(failures).toEqual([]);
			expect(compared).toBeGreaterThanOrEqual(5);
		}, 600_000);

		it('gapToTask refuses inherited attributes that would change the wait (review F1 to F3)', async () => {
			const engine = await bootNodeEngine({ log: () => {} });
			const head = `project p "P" 2026-01-05 +4m {
  scenario plan "Plan" { scenario late "Late" }
}
resource dev "Dev"
shift half "Half" { workinghours mon - fri 9:00 - 12:00 }
`;
			const under = (attr: string): string => `${head}task p "P" {
  ${attr}
  task a "A" { length 2d }
  task b "B" {
    depends !a { gaplength 5d }
    length 2d
  }
}
`;
			// What the intent would have written, by hand, to show why it refuses.
			const byHand = (text: string): string =>
				text.replace(
					'  task b "B" {\n    depends !a { gaplength 5d }',
					'  task w "W" {\n    length 5d\n    depends !a\n  }\n  task b "B" {\n    depends !w',
				);
			const minstart = `${head}task a "A" { length 2d }
task p "P" {
  minstart 2026-01-14
  task b "B" {
    depends a { gaplength 5d }
    length 2d
  }
}
`;
			const at = (r: ScheduleResult, id: string, sc: string): string => {
				const s = r.tasks.find((t) => t.id === id)?.scenarios[sc];
				return `${s?.start}-${s?.end}`;
			};
			const cases: Array<{
				name: string;
				text: string;
				succ: string;
				target: string;
				effect: (base: ScheduleResult, hand: ScheduleResult) => boolean;
			}> = [
				{
					name: 'shifts half (F1)',
					text: under('shifts half'),
					succ: 'p.b',
					target: 'p.a',
					effect: (b, h) => at(b, 'p.b', 'plan') !== at(h, 'p.b', 'plan'),
				},
				{
					name: 'late:shifts half (F1)',
					text: under('late:shifts half'),
					succ: 'p.b',
					target: 'p.a',
					effect: (b, h) =>
						at(b, 'p.b', 'plan') === at(h, 'p.b', 'plan') &&
						at(b, 'p.b', 'late') !== at(h, 'p.b', 'late'),
				},
				{
					name: 'late:allocate dev (F2)',
					text: under('late:allocate dev'),
					succ: 'p.b',
					target: 'p.a',
					effect: (_b, h) =>
						h.bookings.some(
							(x) => x.task === 'p.w' && x.resource === 'dev' && x.scenario === 'late',
						),
				},
				{
					name: 'minstart (F3)',
					text: minstart,
					succ: 'p.b',
					target: 'a',
					effect: (b, h) =>
						h.messages.filter((m) => m.level !== 'debug' && m.level !== 'info').length >
						b.messages.filter((m) => m.level !== 'debug' && m.level !== 'info').length,
				},
			];
			const lines: string[] = [];
			for (const c of cases) {
				const p = plan(c.name, {
					files: { 'plan.tjp': c.text },
					entry: 'plan.tjp',
					revision: 0,
					options: {},
				});
				const base = run(engine, p);
				expect(base.ok, c.name).toBe(true);
				const r = applyIntent(p.snap, p.index, {
					type: 'gapToTask',
					task: c.succ,
					target: c.target,
					name: 'W',
					id: 'w',
				});
				expect(r.status === 'refused' && r.reason, c.name).toBe('conflicting-attribute');
				const handText = byHand(c.text).replace(
					'  task b "B" {\n    depends a { gaplength 5d }',
					'  task w "W" {\n    length 5d\n    depends a\n  }\n  task b "B" {\n    depends !w',
				);
				expect(handText, c.name).not.toBe(c.text);
				const hand = run(engine, p, { 'plan.tjp': handText });
				expect(c.effect(base, hand), `${c.name}: the hand-made conversion changes nothing`).toBe(
					true,
				);
				lines.push(
					`${c.name}: refused; by hand b plan ${at(base, c.succ, 'plan')} -> ${at(hand, c.succ, 'plan')}, ` +
						`late ${at(base, c.succ, 'late')} -> ${at(hand, c.succ, 'late')}, ` +
						`warnings ${base.messages.filter((m) => m.level === 'warning').length} -> ` +
						`${hand.messages.filter((m) => m.level === 'warning').length}`,
				);
			}
			console.log(lines.join('\n'));
		}, 120_000);

		const FIXTURE = `project leave "Leave" 2026-03-02 - 2026-07-31 {
  now 2026-03-02
}
leaves holiday "Spring" 2026-04-06 - 2026-04-08
resource dev "Dev" {
  leaves annual 2026-03-09 - 2026-03-21, sick 2026-03-25 +2d
  leaves special "Course" 2026-04-14
}
resource qa "QA" {
  vacation "Trip" 2026-03-30 - 2026-04-04
  leaves unpaid 2026-04-20 - 2026-04-23
}
task work "Work" { effort 60d allocate dev }
task test "Test" { effort 60d allocate qa }
`;
		const fixture = (): Plan =>
			plan('fixture', {
				files: { 'plan.tjp': FIXTURE },
				entry: 'plan.tjp',
				revision: 0,
				options: {},
			});
		const START = Date.parse('2026-03-02T00:00:00Z') / 1000;
		const minute = (d: string): number => (Date.parse(`${d}T00:00:00Z`) / 1000 - START) / 60;
		/** The fixture's global holiday, in minutes. */
		const HOLIDAY = [minute('2026-04-06'), minute('2026-04-08')] as const;

		/** Working hour slots (minutes) before `horizon` when `resource` is not booked: its leave. */
		function off(r: ScheduleResult, resource: string, horizon: number): Set<number> {
			const booked = new Set<number>();
			for (const b of r.bookings.filter((x) => x.resource === resource))
				for (const [s, e] of b.intervals) for (let m = s; m < e; m += 60) booked.add(m);
			const out = new Set<number>();
			for (const [s, e] of r.project?.workingTime ?? [])
				for (let m = s; m < e && m < horizon; m += 60) if (!booked.has(m)) out.add(m);
			return out;
		}

		const lastBooked = (r: ScheduleResult, resource: string): number =>
			Math.max(
				0,
				...r.bookings
					.filter((b) => b.resource === resource)
					.flatMap((b) => b.intervals.map(([, e]) => e)),
			);

		/** v3 leave minutes of a resource (all types), when the engine sends them. */
		function v3Leaves(r: ScheduleResult, resource: string): Set<number> | null {
			const sc = r.resources.find((x) => x.id === resource)?.scenarios['plan'];
			if (!sc?.leaves) return null;
			const out = new Set<number>();
			for (const l of sc.leaves)
				for (const [s, e] of l.intervals) for (let m = s; m < e; m += 60) out.add(m);
			return out;
		}

		/** The effect check: for each affected person, leave after = leave before minus [from, to). */
		function checkCleared(
			before: ScheduleResult,
			after: ScheduleResult,
			people: readonly string[],
			from: number,
			to: number,
			global: boolean,
		): string[] {
			// A scope clears only its own leave: the global holiday stays on a person's calendar, and a
			// global clear leaves personal leave alone (the fixture's do not overlap the holiday).
			const holiday = (m: number): boolean => m >= HOLIDAY[0] && m < HOLIDAY[1];
			const gone = (m: number): boolean => m >= from && m < to && holiday(m) === global;
			const bad: string[] = [];
			for (const who of people) {
				const horizon = Math.min(lastBooked(before, who), lastBooked(after, who));
				const want = [...off(before, who, horizon)].filter((m) => !gone(m));
				const got = [...off(after, who, horizon)];
				if (
					JSON.stringify(got.sort((a, b) => a - b)) !== JSON.stringify(want.sort((a, b) => a - b))
				)
					bad.push(`${who}: off-duty slots ${got.length}, expected ${want.length}`);
				const v3b = v3Leaves(before, who);
				const v3a = v3Leaves(after, who);
				if (v3b && v3a) {
					const w = [...v3b].filter((m) => !gone(m)).sort((a, b) => a - b);
					if (JSON.stringify([...v3a].sort((a, b) => a - b)) !== JSON.stringify(w))
						bad.push(`${who}: v3 leaves differ`);
				}
			}
			return bad;
		}

		it('clearLeave takes exactly [start, end) off the scope, trimming, splitting and removing', async () => {
			const engine = await bootNodeEngine({ log: () => {} });
			const p = fixture();
			const base = run(engine, p);
			expect(base.ok).toBe(true);
			const cases: Array<[IntentOf<'clearLeave'>, string[]]> = [
				// Split of the annual leave, trim of the sick leave's `+2d`.
				[
					{
						type: 'clearLeave',
						scope: { kind: 'resource', resource: 'dev' },
						start: '2026-03-12',
						end: '2026-03-26',
					},
					['dev'],
				],
				// Removal of the one-day course.
				[
					{
						type: 'clearLeave',
						scope: { kind: 'resource', resource: 'dev' },
						start: '2026-04-13',
						end: '2026-04-16',
					},
					['dev'],
				],
				// Vacation trimmed at its end, unpaid leave trimmed at its start.
				[
					{
						type: 'clearLeave',
						scope: { kind: 'resource', resource: 'qa' },
						start: '2026-04-02',
						end: '2026-04-21',
					},
					['qa'],
				],
				// The global holiday split: off for nobody on the 7th.
				[
					{ type: 'clearLeave', scope: { kind: 'global' }, start: '2026-04-07', end: '2026-04-08' },
					['dev', 'qa'],
				],
			];
			const failures: string[] = [];
			for (const [intent, people] of cases) {
				const files = edited(p, intent);
				expect(files, JSON.stringify(intent)).not.toBeNull();
				const res = run(engine, p, files ?? {});
				expect(res.ok).toBe(true);
				expect(newErrors(base, res)).toEqual([]);
				const bad = checkCleared(
					base,
					res,
					people,
					minute(intent.start),
					minute(intent.end),
					intent.scope.kind === 'global',
				);
				failures.push(...bad.map((b) => `${intent.start}..${intent.end}: ${b}`));
			}
			expect(failures).toEqual([]);
		}, 120_000);

		it('clearLeave reads `+3d` across the DST change in Europe/Berlin (review F4)', async () => {
			const engine = await bootNodeEngine({ log: () => {} });
			// 72 hours from Friday 12:00 CET is Monday 13:00 CEST (29 March has 23 hours).
			const text = `project berlin "Berlin" 2026-03-02 - 2026-05-29 {
  timezone "Europe/Berlin"
  now 2026-03-02
}
resource ann "Ann" {
  leaves sick 2026-03-27-12:00 +3d
}
task work "Work" { effort 40d allocate ann }
`;
			const p = plan('berlin', {
				files: { 'plan.tjp': text },
				entry: 'plan.tjp',
				revision: 0,
				options: {},
			});
			const base = run(engine, p);
			expect(base.ok).toBe(true);
			const intent: IntentOf<'clearLeave'> = {
				type: 'clearLeave',
				scope: { kind: 'resource', resource: 'ann' },
				start: '2026-03-27',
				end: '2026-03-30-10:00',
			};
			const files = edited(p, intent);
			expect(files?.['plan.tjp']).toBe(
				text.replace('sick 2026-03-27-12:00 +3d', 'sick 2026-03-30-10:00 - 2026-03-30-13:00'),
			);
			const res = run(engine, p, files ?? {});
			expect(res.ok).toBe(true);
			expect(newErrors(base, res)).toEqual([]);
			const at = (iso: string): number =>
				(Date.parse(iso) - Date.parse(base.project?.start ?? '')) / 60000;
			const from = at('2026-03-26T23:00:00Z');
			const to = at('2026-03-30T08:00:00Z');
			expect(checkCleared(base, res, ['ann'], from, to, false)).toEqual([]);
			// Monday 10:00 to 13:00 CEST (08:00 to 11:00Z) is still leave; 09:00 to 10:00 is not.
			const offAfter = off(res, 'ann', lastBooked(res, 'ann'));
			expect(
				[at('2026-03-30T08:00:00Z'), at('2026-03-30T10:00:00Z')].every((m) => offAfter.has(m)),
			).toBe(true);
			expect(offAfter.has(at('2026-03-30T07:00:00Z'))).toBe(false);
			expect(offAfter.has(at('2026-03-30T11:00:00Z'))).toBe(false);
		}, 120_000);

		it('clearLeave: random ranges still schedule, with the effect on the fixture', async () => {
			const engine = await bootNodeEngine({ log: () => {} });
			const plans = [
				fixture(),
				...loadCorpus().flatMap((c: Corpus): Plan[] => {
					if (!c.golden.result.ok) return [];
					const p = plan(c.plan.id, planRequest(c.plan, c.golden, ++revision), c.golden.result);
					return p.index.leaves.length > 0 ? [p] : [];
				}),
			];
			const bases = plans.map((p) => run(engine, p));
			// Ranges near a leave item of the plan: a few days before its start to a week after.
			const anchors = plans.map((p) =>
				p.index.leaves.flatMap((l: LeaveSite) =>
					l.items.flatMap((it: SourceRange) => {
						const text = p.snap.files.get(it.file)?.text.sliceString(it.from, it.to) ?? '';
						const d = /\d{4}-\d\d-\d\d/.exec(text)?.[0];
						const who = l.scope.kind === 'resource' ? l.scope.resource : null;
						return d ? [{ day: Date.parse(`${d}T00:00:00Z`) / 1000, who }] : [];
					}),
				),
			);
			const iso = (e: number): string => new Date(e * 1000).toISOString().slice(0, 10);
			const arb = fc
				.integer({ min: 0, max: plans.length - 1 })
				.filter((i) => (anchors[i]?.length ?? 0) > 0)
				.chain((i) =>
					fc.record({
						plan: fc.constant(i),
						anchor: fc.integer({ min: 0, max: (anchors[i]?.length ?? 1) - 1 }),
						own: fc.boolean(),
						scope: fc.integer({ min: -1, max: 4 }),
						from: fc.integer({ min: -3, max: 6 }),
						days: fc.integer({ min: 1, max: 8 }),
					}),
				)
				.map((x) => {
					const a = anchors[x.plan]?.[x.anchor] ?? { day: START, who: null };
					const start = iso(a.day + x.from * 86400);
					const end = iso(a.day + (x.from + x.days) * 86400);
					return { plan: x.plan, own: x.own, who: a.who, scope: x.scope, start, end };
				});
			let edits = 0;
			const outcomes: Record<string, number> = {};
			const failures: string[] = [];
			for (const x of fc.sample(arb, { numRuns: RUNS * 8, ...SEED })) {
				if (edits >= RUNS) break;
				const p = plans[x.plan] as Plan;
				const people = [...p.index.resources.keys()];
				const other = x.scope < 0 ? null : (people[x.scope % Math.max(1, people.length)] ?? null);
				const who = x.own ? x.who : other;
				const { start, end } = x;
				const intent: IntentOf<'clearLeave'> = {
					type: 'clearLeave',
					scope: who ? { kind: 'resource', resource: who } : { kind: 'global' },
					start,
					end,
				};
				const files = edited(p, intent);
				if (!files) {
					const r = applyIntent(p.snap, p.index, intent);
					const k = r.status === 'edit' ? 'edit' : `${r.status}:${r.reason}`;
					outcomes[k] = (outcomes[k] ?? 0) + 1;
					continue;
				}
				edits++;
				const base = bases[x.plan] as ScheduleResult;
				const res = run(engine, p, files);
				const fresh = newErrors(base, res);
				const label = `${p.id} ${JSON.stringify(intent)}`;
				if (res.ok !== base.ok || fresh.length > 0)
					failures.push(`${label}: new ${fresh.join(', ')}`);
				else if (p.id === 'fixture') {
					const bad = checkCleared(
						base,
						res,
						who ? [who] : people,
						minute(start),
						minute(end),
						who === null,
					);
					failures.push(...bad.map((b) => `${label}: ${b}`));
				}
			}
			console.log(
				`clearLeave: ${edits} random edits scheduled; others ${JSON.stringify(outcomes)}`,
			);
			expect(failures).toEqual([]);
			expect(edits).toBeGreaterThanOrEqual(Math.min(RUNS, 10));
		}, 600_000);
	},
);
