// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Each person's time in one scenario of one result (`Availability` in types.ts): their working
 * time, leave, bookings and free time as interval sets. Made once per result and shared by the
 * load model (`LoadInput.availability`) and the explainer (`ExplainContext.availability`).
 *
 * Everything is read from the engine (ADR-0007, ADR-0014 #2): `working` is v3
 * `ResourceScenarioResult.workingTime`, where `null` means exactly `ProjectInfo.workingTime` (the
 * T6 ruling; the project's list is then shared, not copied); `leave` is v3 `leaves`, working-hours
 * slots only, disjoint from `working`; `booked` merges the person's `bookings`; `free` is working
 * minus booked. Groups have no time of their own and are left out: their rows are member sums.
 *
 * The one thing the engine cannot give is the working time lost where two global leaves overlap
 * (ADR-0014 amendment 2026-11-16): TaskJuggler marks those slots off hours, so they are in neither
 * `working` nor `leave`. `overlapLeaveOf` fills them in for the leave hatch, from
 * `ProjectInfo.leaves` and the person's own hours on the same weekday (see there).
 */
import type { Minutes, ProjectInfo } from '../../engine/protocol';
import type { TaskId } from '../tjp/index';
import { offsetAt, type ZoneOffsets } from '../tjp/values/civil';
import { frameEndOf } from './axis';
import { intersect, mergePairs, overlaps, subtract, union } from './intervals';
import type { AvailabilityFn, IntervalSet, PersonAvailability } from './types';

type Pair = readonly [start: Minutes, end: Minutes];

export const availabilityOf: AvailabilityFn = (result, scenario) => {
	const projectTime: IntervalSet = result.project?.workingTime ?? [];
	const tasksOf = new Map<string, Array<{ task: TaskId; intervals: IntervalSet }>>();
	for (const b of result.bookings) {
		if (b.scenario !== scenario || b.intervals.length === 0) continue;
		let list = tasksOf.get(b.resource);
		if (!list) tasksOf.set(b.resource, (list = []));
		list.push({ task: b.task, intervals: b.intervals });
	}
	const people = new Map<string, PersonAvailability>();
	for (const r of result.resources) {
		const rs = r.scenarios[scenario];
		if (r.group || !rs) continue;
		const working: IntervalSet = rs.workingTime ?? projectTime;
		const tasks = tasksOf.get(r.id) ?? [];
		const booked = bookedOf(tasks);
		people.set(r.id, {
			working,
			leave: rs.leaves,
			booked,
			free: subtract(working, booked),
			efficiency: rs.efficiency,
			tasks,
		});
	}
	return { revision: result.revision, scenario, people };
};

/** The merged bookings of a person: one task's set as is, several merged. */
function bookedOf(tasks: ReadonlyArray<{ intervals: IntervalSet }>): IntervalSet {
	if (tasks.length === 0) return [];
	if (tasks.length === 1) return (tasks[0] as { intervals: IntervalSet }).intervals;
	return mergePairs(tasks.flatMap((t) => t.intervals));
}

/** Every leave slot of a person, all types, merged. */
export function allLeave(person: PersonAvailability): IntervalSet {
	let out: IntervalSet = [];
	for (const l of person.leave) out = union(out, l.intervals);
	return out;
}

/**
 * The slots two or more global leaves cover, as TaskJuggler's resource scoreboard marks them
 * (ResourceScenario#initScoreboard): a leave covers the slots from `dateToIdx(start)` up to but
 * not including `dateToIdx(end)`, with `Scoreboard#dateToIdx` truncating and clamping into the
 * frame (so a leave that runs past the end leaves the frame's last slot out).
 */
export function globalLeaveOverlaps(p: ProjectInfo): IntervalSet {
	const res = p.timingResolutionMin;
	const size = Math.floor(frameEndOf(p) / res);
	if (size <= 0 || p.leaves.length < 2) return [];
	const idx = (m: Minutes): number => Math.min(Math.max(Math.trunc(m / res), 0), size - 1);
	const events: Array<[slot: number, delta: number]> = [];
	for (const { interval } of p.leaves) {
		const a = idx(interval[0]);
		const b = idx(interval[1]);
		if (b > a) events.push([a, 1], [b, -1]);
	}
	events.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
	const out: Array<[Minutes, Minutes]> = [];
	let depth = 0;
	let from = 0;
	for (const [slot, delta] of events) {
		if (depth >= 2 && depth + delta < 2 && slot > from) out.push([from * res, slot * res]);
		if (depth < 2 && depth + delta >= 2) from = slot;
		depth += delta;
	}
	return mergePairs(out);
}

const DAY = 1440;
const WEEK = 7 * DAY;
/** How many weeks either side to look for a day with the same weekday outside the overlaps. */
const MAX_WEEKS = 8;

/**
 * Working time the person lost where two or more global leaves overlap, for the leave hatch
 * (ADR-0014 amendment 2026-11-16): slots in such an overlap that are in neither the person's
 * `working` nor `leave`, and that the person works at the same local time on the nearest day with
 * the same weekday outside every overlap (one week before, one after, two before, and so on, up to
 * eight weeks, inside the frame). "Works" means in `working` or `leave`, so a single holiday on
 * that day still counts as hours. Empty without such an overlap.
 */
// T9: the engine gives no working hours for these slots: the person's scoreboard and the
// project's `workingTime` both leave them out. The amendment says "fill such days in from
// ProjectInfo.leaves"; the minutes are taken from the person's own hours a week away, which is
// exact for weekly working hours (part-time included). It is an estimate where hours change by
// date (shifts with periods), where the day it copies has an overtime booking (counted as working
// time there), and where one of its 24-hour pieces crosses a clock change (the shift is taken at
// the piece's start). They are display data for the hatch only, never available time.
export function overlapLeaveOf(
	p: ProjectInfo,
	zones: ZoneOffsets,
	person: PersonAvailability,
	runs: IntervalSet = globalLeaveOverlaps(p),
): IntervalSet {
	if (runs.length === 0) return [];
	const end = frameEndOf(p);
	const res = p.timingResolutionMin;
	const startEpoch = Date.parse(p.start) / 1000;
	const env = { zone: p.timezone, zones };
	const offset = (m: Minutes): number => (offsetAt(env, startEpoch + m * 60) ?? 0) / 60;
	const hours = union(person.working, allLeave(person));
	const out: Array<[Minutes, Minutes]> = [];
	for (const [a, b] of runs) {
		for (let x = a; x < b; x += DAY) {
			const y = Math.min(b, x + DAY);
			for (let n = 1; n <= 2 * MAX_WEEKS; n++) {
				const k = n % 2 === 1 ? -(n + 1) / 2 : n / 2;
				// The same wall-clock time k weeks away, on the slot grid.
				const raw = k * WEEK + offset(x) - offset(x + k * WEEK);
				const shift = Math.round(raw / res) * res;
				const sx = x + shift;
				const sy = y + shift;
				if (sx < 0 || sy > end || overlaps(runs, sx, sy)) continue;
				for (const [s, e] of intersect(hours, [[sx, sy]])) out.push([s - shift, e - shift]);
				break;
			}
		}
	}
	return subtract(mergePairs(out as Pair[]), hours);
}
