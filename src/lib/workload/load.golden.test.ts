// SPDX-License-Identifier: GPL-2.0-or-later
// The golden oracle of the load model (phase-3.md 13.1, 16.1; ADR-0014 #2): for every golden in
// the manifest whose result has a project and resources (picked up automatically, so new
// fixtures join it), at day, week and month zoom, every row of the model (people, and groups as
// the sums of their members) and every bucket:
// - booked minutes equal the golden's `bookings`, and available minutes its `workingTime` (null
//   read as the project's), walked slot by slot;
// - leave minutes equal its `leaves`, except that buckets with slots under two or more global
//   leaves may add up to those slots (the fill-in of the ADR-0014 amendment);
// - every booked slot is a working slot (the amendment: booked never exceeds available);
// - the bounds are the local calendar's: each inner bound is where the slot's local day, week or
//   month changes, and every slot of the frame lies in the bucket of its own key.
// The oracle shares no code with src/lib/workload or civil.ts: local dates come from `Intl`, slot
// by slot, and the tree from the result's own `parent` links.
import { afterAll, describe, expect, it } from 'vitest';
import { loadCorpus } from '../../../tests/golden/corpus';
import type { ProjectInfo, ScheduleResult } from '../../engine/protocol';
import { createTimeZoneHost } from '../../engine/timezone';
import { buildIndex, hintsFromResult } from '../tjp/index';
import { golden } from '../tjp/index/testing';
import { availabilityOf } from './availability';
import { buildLoad } from './load';
import type { BucketKind } from './types';

const zones = createTimeZoneHost();
const NO_TIMINGS = { writeFsMs: 0, parseMs: 0, scheduleMs: 0, serializeMs: 0, totalMs: 0 };
const KINDS: BucketKind[] = ['day', 'week', 'month'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Key = number;
type Sums = Map<Key, number>;

/** The bucket key of each slot start, by Intl, per zoom. */
function slotKeys(p: ProjectInfo): Record<BucketKind, Int32Array> {
	const res = p.timingResolutionMin;
	const startMs = Date.parse(p.start);
	const size = (Date.parse(p.end) - startMs) / 60_000 / res;
	const f = new Intl.DateTimeFormat('en-US', {
		timeZone: p.timezone ?? 'UTC',
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		weekday: 'short',
	});
	const out = {
		day: new Int32Array(size),
		week: new Int32Array(size),
		month: new Int32Array(size),
	};
	for (let s = 0; s < size; s++) {
		const parts = Object.fromEntries(
			f.formatToParts(new Date(startMs + s * res * 60_000)).map((x) => [x.type, x.value]),
		);
		const y = Number(parts.year);
		const m = Number(parts.month);
		const dayNo = Date.UTC(y, m - 1, Number(parts.day)) / 86_400_000;
		const wd = WEEKDAYS.indexOf(parts.weekday ?? '');
		out.day[s] = dayNo;
		out.week[s] = dayNo - ((wd - (p.weekStartsMonday ? 1 : 0) + 7) % 7);
		out.month[s] = y * 12 + m - 1;
	}
	return out;
}

/** Slot indices of [start, end) pairs (every bound must be on the slot grid). */
function slotsOf(pairs: ReadonlyArray<readonly [number, number]>, res: number): number[] {
	const out: number[] = [];
	for (const [a, b] of pairs) {
		if (a % res !== 0 || b % res !== 0) throw new Error(`[${a}, ${b}) is off the slot grid`);
		for (let m = a; m < b; m += res) out.push(m / res);
	}
	return out;
}

interface Oracle {
	booked: Sums;
	available: Sums;
	leave: Sums;
}

interface Coverage {
	id: string;
	people: number;
	groups: number;
	days: number;
	weeks: number;
	months: number;
	cells: number;
}
const coverage: Coverage[] = [];

const corpus = loadCorpus().filter(
	({ golden: g }) => g.result.project !== null && g.result.resources.length > 0,
);

describe('the load model against every golden with resources', () => {
	it('picks up every golden with resources, the gate plan and the workload fixtures included', () => {
		const ids = corpus.map((c) => c.plan.id);
		for (const id of ['fedora-res', 'syn-13-calendars-leaves', 'syn-15-allocate-select']) {
			expect(ids).toContain(id);
		}
		expect(ids).toContain('syn-21-tz-dst-edges-newyork');
		expect(ids).toContain('syn-23-unused-resources');
		expect(ids.filter((id) => id.startsWith('workload-')).length).toBe(12);
	});

	for (const { plan, golden: g } of corpus) {
		it(`matches the slot-by-slot oracle (${plan.id})`, () => {
			const result: ScheduleResult = { ...g.result, revision: 1, timings: NO_TIMINGS };
			const p = result.project as ProjectInfo;
			const res = p.timingResolutionMin;
			const scenario = p.scenarios.find((s) => s.active)?.id;
			if (!scenario) throw new Error('no active scenario');
			const index = buildIndex(
				golden(plan.id).snapshot(),
				hintsFromResult(result, (_f, l) => l),
				{ cache: null },
			);
			const keys = slotKeys(p);

			// The tree from the result: each resource's leaf members.
			const kids = new Map<string, string[]>();
			for (const r of result.resources) {
				if (r.parent) kids.set(r.parent, [...(kids.get(r.parent) ?? []), r.id]);
			}
			const leavesOf = (id: string): string[] => {
				const k = kids.get(id) ?? [];
				return k.length === 0 ? [id] : k.flatMap(leavesOf);
			};

			// Slots under two or more global leaves, as TaskJuggler's scoreboard marks them.
			const size = keys.day.length;
			const cover = new Int32Array(size);
			for (const { interval } of p.leaves) {
				const idx = (m: number) => Math.min(Math.max(Math.trunc(m / res), 0), size - 1);
				for (let s = idx(interval[0]); s < idx(interval[1]); s++)
					cover[s] = (cover[s] as number) + 1;
			}

			// Per leaf and zoom: booked, working and leave minutes per bucket key.
			const leafSums = new Map<string, Record<BucketKind, Oracle>>();
			for (const r of result.resources) {
				const rs = r.scenarios[scenario];
				if (r.group || !rs) continue;
				const booked = result.bookings
					.filter((b) => b.scenario === scenario && b.resource === r.id)
					.flatMap((b) => slotsOf(b.intervals, res));
				const working = slotsOf(rs.workingTime ?? p.workingTime, res);
				const leave = rs.leaves.flatMap((l) => slotsOf(l.intervals, res));
				const workSet = new Set(working);
				const offWork = booked.filter((s) => !workSet.has(s));
				expect(offWork, `${r.id}: booked slots outside working time`).toEqual([]);
				expect(new Set(booked).size, `${r.id} is never booked twice`).toBe(booked.length);
				const entry = {} as Record<BucketKind, Oracle>;
				for (const kind of KINDS) {
					const sum = (slots: number[]): Sums => {
						const m: Sums = new Map();
						for (const s of slots) {
							const k = keys[kind][s] as number;
							m.set(k, (m.get(k) ?? 0) + res);
						}
						return m;
					};
					entry[kind] = { booked: sum(booked), available: sum(working), leave: sum(leave) };
				}
				leafSums.set(r.id, entry);
			}

			const row = (id: string, kind: BucketKind, what: keyof Oracle, key: Key): number =>
				leavesOf(id).reduce((n, leaf) => n + (leafSums.get(leaf)?.[kind][what].get(key) ?? 0), 0);

			const counts: Partial<Record<BucketKind, number>> = {};
			let cells = 0;
			for (const kind of KINDS) {
				const m = buildLoad({
					result,
					index,
					zones,
					kind,
					collapsed: new Set(),
					availability: availabilityOf(result, scenario),
					demand: null,
				});
				counts[kind] = m.axis.count;
				expect(m.rows.map((r) => r.id)).toEqual(result.resources.map((r) => r.id));
				const bucketKeys = Array.from({ length: m.axis.count }, (_, i) => {
					const first = Math.max(m.axis.bounds[i] as number, 0) / res;
					expect(Number.isInteger(first), 'bucket starts on the slot grid').toBe(true);
					return keys[kind][first] as number;
				});
				expect(new Set(bucketKeys).size).toBe(m.axis.count);
				// Each inner bound is where the local key changes: the slot before it has another key.
				const unchanged: number[] = [];
				for (let i = 1; i < m.axis.count; i++) {
					const s = (m.axis.bounds[i] as number) / res;
					if (keys[kind][s - 1] === keys[kind][s]) unchanged.push(i);
				}
				expect(unchanged, `${kind} bounds with the same key on both sides`).toEqual([]);
				// Every slot of the frame lies in the bucket of its own key.
				const misplaced: number[] = [];
				const overlapIn = new Int32Array(m.axis.count);
				for (let s = 0; s < size; s++) {
					const c = m.axis.indexOf(s * res);
					if (bucketKeys[c] !== keys[kind][s]) misplaced.push(s);
					if ((cover[s] as number) >= 2) overlapIn[c] = (overlapIn[c] as number) + res;
				}
				expect(misplaced.slice(0, 5), `${kind} slots outside their bucket`).toEqual([]);
				m.rows.forEach((r, i) => {
					for (const what of ['booked', 'available'] as const) {
						const got = [...(m[what][i] as Int32Array)];
						const want = bucketKeys.map((k) => row(r.id, kind, what, k));
						expect(got, `${r.id} ${what} per ${kind}`).toEqual(want);
						const total = [...new Set(keys[kind])].reduce(
							(n, k) => n + row(r.id, kind, what, k),
							0,
						);
						expect(
							got.reduce((n, v) => n + v, 0),
							`${r.id} ${what} over the frame`,
						).toBe(total);
					}
					const leave = m.leave[i] as Int32Array;
					bucketKeys.forEach((k, c) => {
						const engine = row(r.id, kind, 'leave', k);
						const extra = (leave[c] as number) - engine;
						const room = (overlapIn[c] as number) * leavesOf(r.id).length;
						expect(extra, `${r.id} leave in ${kind} ${c}`).toBeGreaterThanOrEqual(0);
						expect(extra, `${r.id} leave in ${kind} ${c}`).toBeLessThanOrEqual(room);
					});
					expect(m.held[i]?.every((v) => v === 0)).toBe(true);
					cells += m.axis.count;
				});
			}
			coverage.push({
				id: plan.id,
				people: leafSums.size,
				groups: result.resources.filter((r) => r.group).length,
				days: counts.day ?? 0,
				weeks: counts.week ?? 0,
				months: counts.month ?? 0,
				cells,
			});
		}, 60_000);
	}

	afterAll(() => {
		const total = (k: keyof Omit<Coverage, 'id'>) => coverage.reduce((n, c) => n + c[k], 0);
		const fedora = coverage.find((c) => c.id === 'fedora-res');
		console.info(
			[
				`load oracle: ${coverage.length} goldens, ${total('people')} people, ${total('groups')} groups,`,
				`${total('weeks')} weeks (${total('days')} days, ${total('months')} months), ${total('cells')} cells per series`,
				fedora
					? `fedora-res: ${fedora.people} people + ${fedora.groups} groups x ${fedora.weeks} weeks = ${(fedora.people + fedora.groups) * fedora.weeks} week cells`
					: 'fedora-res: not in the manifest',
				...coverage.map(
					(c) =>
						`  ${c.id}: ${c.people} people, ${c.groups} groups, ${c.days} d / ${c.weeks} w / ${c.months} m`,
				),
			].join('\n'),
		);
	});
});
