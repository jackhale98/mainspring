// SPDX-License-Identifier: GPL-2.0-or-later
// The explainer and demand against the engine, on every golden with resources (phase-3.md 6.3,
// 13.1; picked up from the manifest, so new fixtures join it). The checks read the golden's raw
// result (bookings, workingTime null read as the project's, leaves, resource parents), slot by
// slot, sharing no code with explain*.ts or src/lib/workload:
// - a held window never overlaps a booking of its task, lies on or before the task's start (ASAP)
//   or after its end (ALAP), and the person had no free working time in it;
// - an unmet window lies inside the task's span, the person is never on the task in it, and every
//   working slot of theirs in it is booked on another task (leave slots are never inside one);
// - every task's windowed causes tile the wait for each person it asked for, busy causes cover only
//   slots booked elsewhere or off hours, leave and off-hours causes no working slot, and the busy
//   minutes are the person's booked minutes there;
// - inside causes lie inside the bar and never overlap its bookings;
// - an ASAP effort leaf the explainer puts on its bound starts in the first slot its people work at
//   or after its dependencies and written dates, computed without the explainer (the review, F4).
// Then fedora-res: the counts, and two tasks checked by hand against the text and the bookings.
import { describe, expect, it } from 'vitest';
import { loadCorpus } from '../../../tests/golden/corpus';
import type { ScheduleResult } from '../../engine/protocol';
import { demandOf } from './demand';
import { explainTask } from './explain-task';
import { firstSlotOracle, goldenContext, partitionProblems, windowed } from './explain-testing';

const corpus = loadCorpus().filter(
	({ golden: g }) => g.result.project !== null && g.result.resources.length > 0,
);

/** Slot sets from the raw result, by the slot start minute. */
function slotsOf(r: ScheduleResult, scenario: string) {
	const res = r.project?.timingResolutionMin ?? 60;
	const add = (set: Set<number>, pairs: ReadonlyArray<readonly [number, number]>) => {
		for (const [a, b] of pairs) for (let m = a; m < b; m += res) set.add(m);
		return set;
	};
	const working = new Map<string, Set<number>>();
	const leave = new Map<string, Set<number>>();
	for (const p of r.resources) {
		const s = p.scenarios[scenario];
		if (p.group || !s) continue;
		working.set(p.id, add(new Set(), s.workingTime ?? r.project?.workingTime ?? []));
		leave.set(
			p.id,
			add(
				new Set(),
				s.leaves.flatMap((l) => l.intervals),
			),
		);
	}
	const booked = new Map<string, Map<number, string>>();
	const onTask = new Map<string, Set<number>>();
	for (const b of r.bookings) {
		if (b.scenario !== scenario) continue;
		let m = booked.get(b.resource);
		if (!m) booked.set(b.resource, (m = new Map()));
		for (const [a, e] of b.intervals) for (let t = a; t < e; t += res) m.set(t, b.task);
		add(onTask.get(b.task) ?? onTask.set(b.task, new Set()).get(b.task) ?? new Set(), b.intervals);
	}
	const slots = function* (a: number, b: number) {
		for (let m = Math.floor(a / res) * res; m < b; m += res) if (m + res > a) yield m;
	};
	const leaves = (id: string): string[] => {
		const p = r.resources.find((x) => x.id === id);
		if (!p) return [];
		if (!p.group) return [id];
		return r.resources.filter((x) => x.parent === id).flatMap((x) => leaves(x.id));
	};
	return { working, leave, booked, onTask, slots, leaves, res };
}

interface Row {
	id: string;
	tasks: number;
	held: number;
	unmet: number;
	causes: number;
	/** Effort leaves on their bound, checked against the independent first slot. */
	onBound: number;
}
const rows: Row[] = [];

describe('demand and causes against the bookings of every golden with resources', () => {
	it('covers the golden plans with resources, fedora-res and the fixtures among them', () => {
		const ids = corpus.map((c) => c.plan.id);
		for (const id of ['fedora-res', 'health-h7-fail', 'health-h8-fail', 'workload-held-effort']) {
			expect(ids).toContain(id);
		}
		expect(ids.length).toBeGreaterThan(40);
	});

	for (const { plan } of corpus) {
		it(`agrees with the bookings (${plan.id})`, () => {
			const ctx = goldenContext(plan.id);
			const r = ctx.result;
			const sc = ctx.scenario;
			const S = slotsOf(r, sc);
			const task = (id: string) => r.tasks.find((t) => t.id === id)?.scenarios[sc];
			const demand = demandOf(ctx);
			const problems: string[] = [];
			const say = (s: string) => problems.length < 20 && problems.push(s);

			for (const [p, entries] of demand.held) {
				for (const {
					task: id,
					window: [a, b],
				} of entries) {
					const s = task(id);
					if (!s || s.start === null || s.end === null || b <= a) {
						say(`held ${id}: no dates or empty`);
						continue;
					}
					if (s.direction === 'asap' ? b !== s.start : a !== s.end)
						say(`held ${id} off its anchor`);
					for (const m of S.slots(a, b)) {
						if (S.onTask.get(id)?.has(m)) say(`held ${id} overlaps its booking at ${m}`);
						if (S.working.get(p)?.has(m) && !S.booked.get(p)?.has(m))
							say(`held ${id}: ${p} free at ${m}`);
					}
				}
			}
			for (const [p, entries] of demand.unmet) {
				for (const {
					task: id,
					window: [a, b],
				} of entries) {
					const s = task(id);
					if (!s || s.start === null || s.end === null || a < s.start || b > s.end || b <= a) {
						say(`unmet ${id} [${a}, ${b}) outside its span`);
						continue;
					}
					for (const m of S.slots(a, b)) {
						const on = S.booked.get(p)?.get(m);
						if (on === id) say(`unmet ${id}: ${p} is on it at ${m}`);
						if (S.working.get(p)?.has(m) && on === undefined) say(`unmet ${id}: ${p} free at ${m}`);
						if (S.leave.get(p)?.has(m)) say(`unmet ${id}: ${p} on leave at ${m}`);
					}
				}
			}

			let causes = 0;
			let onBound = 0;
			for (const t of r.tasks) {
				const s = t.scenarios[sc];
				const pl = explainTask(t.id, ctx);
				causes += pl.causes.length + pl.inside.length;
				// F4: "on its bound" must be true without the code's own bound: such an effort leaf
				// starts in the first slot its people work at or after its dependencies and dates.
				if (pl.anchor === 'start' && pl.at !== null && pl.bound !== null) {
					if (pl.at <= pl.bound && pl.bound - pl.at < S.res) {
						const first = firstSlotOracle(ctx, t.id);
						if (first !== null) {
							onBound++;
							if (first !== pl.at) say(`${t.id}: on its bound at ${pl.at}, but free from ${first}`);
						}
					}
				}
				if (!s || pl.at === null || pl.bound === null) continue;
				const people = [...new Set(s.allocate.flatMap((i) => i.candidates.flatMap(S.leaves)))];
				const [lo, hi] = pl.anchor === 'start' ? [pl.bound, pl.at] : [pl.at, pl.bound];
				const wait = windowed(pl.causes);
				if (wait.length > 0) {
					const ids = people.length > 0 ? people : ['(project)'];
					for (const e of partitionProblems(pl.causes, ids, lo, hi)) say(`${t.id}: ${e}`);
				}
				for (const c of [...wait, ...windowed(pl.inside)]) {
					const named = c.resource === null ? people : [c.resource];
					let busy = 0;
					for (const m of S.slots(c.window[0], c.window[1])) {
						for (const p of named) {
							const on = S.booked.get(p)?.get(m);
							if (on === t.id) say(`${t.id}: ${c.kind} over its own booking at ${m}`);
							if (c.kind === 'busy' && S.working.get(p)?.has(m)) {
								if (on === undefined) say(`${t.id}: busy ${p} free at ${m}`);
								else busy += S.res;
							}
							if (c.kind !== 'busy' && S.working.get(p)?.has(m))
								say(`${t.id}: ${c.kind} on ${p}'s working slot ${m}`);
						}
					}
					if (c.kind === 'busy' && busy !== c.on.reduce((n, o) => n + o.minutes, 0)) {
						say(`${t.id}: busy minutes ${busy} against ${JSON.stringify(c.on)}`);
					}
				}
				for (const c of windowed(pl.inside)) {
					if (s.start === null || s.end === null) continue;
					if (c.window[0] < s.start || c.window[1] > s.end)
						say(`${t.id}: inside cause outside the bar`);
				}
			}
			expect(problems).toEqual([]);
			const count = (m: ReadonlyMap<string, ReadonlyArray<{ task: string }>>) =>
				new Set([...m.values()].flat().map((e) => e.task)).size;
			rows.push({
				id: plan.id,
				tasks: r.tasks.length,
				held: count(demand.held),
				unmet: count(demand.unmet),
				causes,
				onBound,
			});
		}, 60_000);
	}

	it('finds held and unmet work across the corpus', () => {
		const sum = (f: (x: Row) => number) => rows.reduce((n, x) => n + f(x), 0);
		expect(sum((x) => x.held)).toBeGreaterThan(20);
		expect(sum((x) => x.unmet)).toBeGreaterThan(20);
		expect(sum((x) => x.onBound)).toBeGreaterThan(50);
		for (const x of rows) {
			console.info(
				`${x.id}: ${x.tasks} tasks, held ${x.held}, unmet ${x.unmet}, ${x.causes} causes, ` +
					`${x.onBound} on their bound checked`,
			);
		}
	});
});

describe('fedora-res, checked by hand', () => {
	const ctx = goldenContext('fedora-res');
	const demand = demandOf(ctx);
	// New York summer time (EDT, UTC-4), in minutes since the frame start, 2013-04-30 00:00 UTC.
	const ny = (month: number, day: number, hour: number): number =>
		(Date.UTC(2013, month - 1, day, hour + 4) - Date.UTC(2013, 3, 30)) / 60_000;
	const entries = (p: string, task: string) =>
		(demand.unmet.get(p) ?? []).filter((e) => e.task === task).map((e) => e.window);

	it('has no held work: every Fedora task is a length or duration task', () => {
		expect(demand.held.size).toBe(0);
		const tasks = new Set([...demand.unmet.values()].flat().map((e) => e.task));
		expect(tasks.size).toBe(68);
	});

	it('supplement_license_review runs 7 of its 10 days without desk01', () => {
		// `length 10d` from Tue 27 Aug 17:00 to Wed 11 Sep 17:00 (after decide_supplement_wallpaper
		// and a 1-day gap); mainspring-load.tji allocates desk01, who is on test_branch_guides
		// Wed 28 Aug to Fri 6 Sep and on this task only Mon 9 to Wed 11 Sep. Labor Day (Mon 2 Sep,
		// a global holiday) is leave, so the two runs are not joined across it.
		expect(entries('desk01', 'f20.supplement_wallpaper.supplement_license_review')).toEqual([
			[ny(8, 28, 9), ny(8, 30, 17)],
			[ny(9, 3, 9), ny(9, 6, 17)],
		]);
	});

	it('feature_profiles misses each of its two people on their own days', () => {
		// `length 20d`, Thu 15 Aug 17:00 to Fri 13 Sep 17:00; `allocate server02, qa03` (two items).
		// server02 is on trans_software_review Thu 29 Aug to Fri 6 Sep; qa03 on update_bookmarks
		// Fri 30 Aug and Tue 3 Sep. Each item is unmet on its own person's days only.
		const id = 'f20.TestingPhase.alpha.feature_profiles';
		expect(entries('server02', id)).toEqual([
			[ny(8, 29, 9), ny(8, 30, 17)],
			[ny(9, 3, 9), ny(9, 6, 17)],
		]);
		expect(entries('qa03', id)).toEqual([
			[ny(8, 30, 9), ny(8, 30, 17)],
			[ny(9, 3, 9), ny(9, 3, 17)],
		]);
	});
});
