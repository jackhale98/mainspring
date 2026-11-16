// SPDX-License-Identifier: GPL-2.0-or-later
//
// cross-check-load.mjs - pure helpers for the schema v3 load cross-check of record-native.mjs
// (docs/phases/phase-3.md 5.3): the report text for a plan (cross-check-load.tji with its macros
// set), and the comparison of tj3's weekly resource report with what a golden's bookings,
// workingTime and leaves say it must hold. No file system and no child processes, so
// tests/golden/cross-check-load.test.ts tests them directly.
//
// How tj3 computes each value (engine/tj/lib/taskjuggler/, read only), for a slot range [a, b)
// of one resource; a group sums its leaf members (ResourceScenario#treeSum, getEffectiveWork):
// - effort: booked slots in hours, times efficiency (getEffectiveWork, ResourceScenario.rb:546);
// - freework: free slots (workingTime minus bookings) in hours, times efficiency (594);
// - freetime: free slots in hours, not weighted (586, query_freetime at 389). For a leaf the
//   query divides Integer seconds by 86400 as integers, so it prints whole 24-hour days: 40 free
//   hours read 24. A group's sum is a Float, so its value is exact;
// - timeoffdays: leave slots in working hours, all types, times efficiency (getTimeOffSlots);
// - annualleave, specialleave, sickleave, unpaidleave: one type's leave slots in working hours,
//   not weighted (getLeave, getLeaveSlots).
// The slot range of a week [t, next) is [dateToIdx(t), dateToIdx(next)] with Project#dateToIdx's
// clamping (Project.rb:961-974): a date before the start is slot 0, a date after the end is
// scoreboardSize - 1, so a last week that runs past the end leaves out the frame's last slot.

import { minutesToIso } from './lib.mjs';

export const LOAD_REPORT_ID = 'mainspring_crossload';
/** Where record-native.mjs writes the report file, and the CSV tj3 writes, in the workspace. */
export const LOAD_TJI = 'mainspring-cross-check-load.tji';
export const LOAD_CSV = 'mainspring-cross-check-load.csv';

const SCENARIOS_MACRO = /^macro mainspring_crossload_scenarios \[[^\]]*\]$/m;
const TIMEZONE_MACRO = /^macro mainspring_crossload_timezone \[[^\]]*\]$/m;

/** The celltext queries of cross-check-load.tji, in order. */
export const LOAD_QUERIES = [
	'effort', 'freework', 'freetime', 'timeoffdays', 'annualleave', 'specialleave', 'sickleave', 'unpaidleave',
];
/** The EngineLeaveType of each one-type leave query, in LOAD_QUERIES order. */
const LEAVE_QUERY_TYPES = ['annual', 'special', 'sick', 'unpaid'];

/**
 * @typedef {[number, number]} Pair
 * @typedef {{ id: string, name: string, active: boolean }} Scenario
 * @typedef {{ efficiency: number, workingTime: Pair[] | null, leaves: Array<{ type: string, intervals: Pair[] }> }} ResourceScenario
 * @typedef {{ id: string, parent: string | null, group: boolean, scenarios: Record<string, ResourceScenario> }} Resource
 * @typedef {{ scenario: string, resource: string, intervals: Pair[] }} Booking
 * @typedef {{ start: string, end: string, timezone: string | null, timingResolutionMin: number, scenarios: Scenario[], weekStartsMonday?: boolean, workingTime: Pair[] }} Project
 * @typedef {{ project: Project | null, resources: Resource[], bookings: Booking[] }} LoadResult
 */

/**
 * cross-check-load.tji for a golden's result: the active scenario ids in pre-order and the plan's
 * time zone (UTC when it sets none) written into the template's macros.
 * @param {string} template
 * @param {LoadResult} result
 */
export function loadReport(template, result) {
	if (!SCENARIOS_MACRO.test(template) || !TIMEZONE_MACRO.test(template)) {
		throw new Error('cross-check-load.tji lost one of its macro lines');
	}
	if (!result.project) throw new Error('no project to report on');
	const ids = result.project.scenarios.filter((s) => s.active).map((s) => s.id);
	const zone = result.project.timezone ?? 'UTC';
	if (/["\]\\\n]/.test(zone)) throw new Error(`time zone ${JSON.stringify(zone)} cannot go in a macro`);
	return template
		.replace(SCENARIOS_MACRO, () => `macro mainspring_crossload_scenarios [${ids.join(', ')}]`)
		.replace(TIMEZONE_MACRO, () => `macro mainspring_crossload_timezone ["${zone}"]`);
}

const WEEK_RE = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)([+-])(\d\d)(\d\d)$/;

/**
 * A week start as the report header prints it (timeformat "%Y-%m-%dT%H:%M:%S%z", local time with
 * its UTC offset): the instant, and the wall-clock digits as UTC milliseconds.
 * @param {string} text
 */
export function parseWeekStart(text) {
	const m = WEEK_RE.exec(text);
	if (!m) throw new Error(`unexpected week header ${JSON.stringify(text)}`);
	const [y, mo, d, h, mi, s, sign, oh, om] = m.slice(1);
	const wall = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
	const offset = (sign === '-' ? -1 : 1) * (Number(oh) * 60 + Number(om)) * 60_000;
	return { ms: wall - offset, wall };
}

/**
 * The wall-clock time of the instant `ms` in `zone`, as UTC milliseconds of the same digits.
 * @param {number} ms
 * @param {string} zone
 */
export function wallClockMs(ms, zone) {
	const format = new Intl.DateTimeFormat('en-US', {
		timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
		hour: '2-digit', minute: '2-digit', second: '2-digit',
	});
	const p = Object.fromEntries(format.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
	return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute),
		Number(p.second));
}

/**
 * The report's CSV (parsed with cross-check-rows.mjs parseCsv) as week headers and rows. Each row
 * has the plain `weekly` cells (effort in hours, '' for zero) and the celltext cells (the
 * LOAD_QUERIES values). The id is carried forward: tj3 leaves it empty on the rows of the second
 * and later scenarios of a resource, and indents it in tree order.
 * @param {string[][]} csv
 */
export function parseLoadCsv(csv) {
	const [header, ...rows] = csv;
	if (!header || header[0] !== 'Scenario' || header[1] !== 'Id' || header.length < 4 || header.length % 2) {
		throw new Error(`unexpected load report header: ${JSON.stringify(header?.slice(0, 4))}`);
	}
	const k = (header.length - 2) / 2;
	const weeks = header.slice(2, 2 + k);
	if (weeks.join(';') !== header.slice(2 + k).join(';')) throw new Error('the two weekly columns have different weeks');
	const number = (/** @type {string} */ text, /** @type {string} */ where) => {
		const v = text.trim() === '' ? 0 : Number(text);
		if (!Number.isFinite(v)) throw new Error(`${where}: not a number: ${JSON.stringify(text)}`);
		return v;
	};
	let lastId = '';
	return {
		weeks,
		rows: rows.map((cells, r) => {
			if (cells.length !== header.length) throw new Error(`load report row ${r + 1} has ${cells.length} cells`);
			const id = (cells[1] ?? '').trim() || lastId;
			lastId = id;
			const where = `row ${r + 1} (${id})`;
			return {
				scenario: cells[0] ?? '',
				id,
				plain: cells.slice(2, 2 + k).map((c) => number(c, where)),
				cells: cells.slice(2 + k).map((c) => {
					const values = c.split('|');
					if (values.length !== LOAD_QUERIES.length) throw new Error(`${where}: celltext ${JSON.stringify(c)}`);
					return values.map((v) => number(v, where));
				}),
			};
		}),
	};
}

/** Minutes of `pairs` inside [a, b). */
function within(/** @type {Pair[]} */ pairs, /** @type {number} */ a, /** @type {number} */ b) {
	let sum = 0;
	for (const [s, e] of pairs) {
		const lo = Math.max(s, a);
		const hi = Math.min(e, b);
		if (hi > lo) sum += hi - lo;
	}
	return sum;
}

/**
 * The slot ranges tj3 used: the frame, then each week, as [first, stop) slot indices (see the
 * header). The last week ends at the frame's end when TaskJuggler's next week start
 * (TjTime#sameTimeNextWeek: the same wall-clock time 7 days on) is the frame's end, and one slot
 * earlier otherwise; `wallClock` reads the end's wall-clock time in the plan's zone.
 * @param {Project} project
 * @param {string[]} weeks
 * @param {(ms: number, zone: string) => number} [wallClock]
 */
export function loadRanges(project, weeks, wallClock = wallClockMs) {
	const startMs = Date.parse(project.start);
	const endMs = Date.parse(project.end);
	const res = project.timingResolutionMin;
	const endMin = (endMs - startMs) / 60_000;
	const size = endMin / res;
	if (!Number.isInteger(size)) throw new Error(`the frame is not a whole number of ${res}-minute slots`);
	const idx = (/** @type {number} */ ms) => {
		const m = (ms - startMs) / 60_000;
		return m < 0 ? 0 : m > endMin ? size - 1 : Math.floor(m / res);
	};
	const starts = weeks.map(parseWeekStart);
	const last = starts[starts.length - 1];
	if (!last || last.ms >= endMs || endMs - last.ms > 7 * 86_400_000 + 3_600_000) {
		throw new Error(`the weeks ${weeks[0]} to ${weeks[weeks.length - 1]} do not end at the frame's end ${project.end}`);
	}
	const lastStop = last.wall + 7 * 86_400_000 === wallClock(endMs, project.timezone ?? 'UTC') ? size : size - 1;
	const week = starts.map((w, j) => {
		const next = starts[j + 1];
		return /** @type {Pair} */ ([idx(w.ms), next ? idx(next.ms) : lastStop]);
	});
	return { frame: /** @type {Pair} */ ([0, size]), weeks: week, res };
}

/**
 * The LOAD_QUERIES values tj3 must print for each resource and active scenario over the slot
 * ranges, keyed "<scenario name>\n<resource id>": `plain` is the effort of each week, `cells` the
 * celltext column (the frame first, then week k-1 in cell k).
 * @param {LoadResult} result
 * @param {ReturnType<typeof loadRanges>} ranges
 */
export function expectedLoad(result, ranges) {
	if (!result.project) return new Map();
	const project = result.project;
	const active = project.scenarios.filter((s) => s.active);
	if (new Set(active.map((s) => s.name)).size !== active.length) throw new Error('active scenarios share a name');
	const { res } = ranges;
	const all = [ranges.frame, ...ranges.weeks];
	/** @type {Map<string, Pair[]>} */
	const booked = new Map();
	for (const b of result.bookings) {
		const key = `${b.scenario}\n${b.resource}`;
		booked.set(key, [...(booked.get(key) ?? []), ...b.intervals]);
	}
	/** @type {Map<string, Resource[]>} */
	const kids = new Map();
	for (const r of result.resources) if (r.parent) kids.set(r.parent, [...(kids.get(r.parent) ?? []), r]);
	/** @returns {Resource[]} */
	const leavesOf = (/** @type {Resource} */ r) => (r.group ? (kids.get(r.id) ?? []).flatMap(leavesOf) : [r]);

	/** The LOAD_QUERIES values of leaf `r` in scenario `sc` over slots [a, b); freetime unfloored. */
	const leafValues = (/** @type {Resource} */ r, /** @type {string} */ sc, /** @type {Pair} */ [a, b]) => {
		const rs = r.scenarios[sc];
		if (!rs) throw new Error(`resource ${r.id} has no scenario ${sc}`);
		const lo = a * res;
		const hi = b * res;
		const bookedMin = within(booked.get(`${sc}\n${r.id}`) ?? [], lo, hi);
		// A null workingTime is the project's (protocol.ts, T6 review ruling).
		const freeMin = within(rs.workingTime ?? project.workingTime, lo, hi) - bookedMin;
		const leave = (/** @type {string} */ type) => within(rs.leaves.find((l) => l.type === type)?.intervals ?? [], lo, hi);
		const leaveMin = rs.leaves.reduce((n, l) => n + within(l.intervals, lo, hi), 0);
		const eff = rs.efficiency;
		return [bookedMin / 60 * eff, freeMin / 60 * eff, freeMin / 60, leaveMin / 60 * eff,
			...LEAVE_QUERY_TYPES.map((t) => leave(t) / 60)];
	};
	const values = (/** @type {Resource} */ r, /** @type {string} */ sc, /** @type {Pair} */ range) => {
		if (!r.group) {
			const v = leafValues(r, sc, range);
			v[2] = Math.floor(/** @type {number} */ (v[2]) / 24) * 24;
			return v;
		}
		const sum = LOAD_QUERIES.map(() => 0);
		for (const leaf of leavesOf(r)) leafValues(leaf, sc, range).forEach((v, i) => { sum[i] = (sum[i] ?? 0) + v; });
		return sum;
	};

	/** @type {Map<string, { plain: number[], cells: number[][] }>} */
	const out = new Map();
	for (const r of result.resources) {
		for (const s of active) {
			const cells = all.map((range) => values(r, s.id, range));
			out.set(`${s.name}\n${r.id}`, {
				plain: cells.slice(1).map((v) => /** @type {number} */ (v[0])),
				cells: cells.slice(0, cells.length - 1),
			});
		}
	}
	return out;
}

/** True when tj3's printed value (6 fraction digits) is `expected`. */
function same(/** @type {number} */ expected, /** @type {number} */ printed) {
	return Math.abs(expected - printed) <= 5e-7 + 1e-12 * Math.abs(expected);
}

/**
 * Where tj3's load report and the golden disagree (at most `limit` lines), and what was compared.
 * @param {LoadResult} result
 * @param {string[][]} csv  the parsed CSV including its header row
 * @param {{ limit?: number, wallClock?: (ms: number, zone: string) => number }} [opts]
 */
export function loadDiffs(result, csv, opts = {}) {
	const limit = opts.limit ?? 10;
	const { weeks, rows } = parseLoadCsv(csv);
	if (!result.project) throw new Error('no project to compare');
	const ranges = loadRanges(result.project, weeks, opts.wallClock);
	const expected = expectedLoad(result, ranges);
	const start = result.project.start;
	/** @type {string[]} */
	const problems = [];
	const add = (/** @type {string} */ line) => {
		if (problems.length < limit) problems.push(line);
	};
	// The weeks are TaskJuggler's (beginOfWeek with the project's weekstartsmonday), so each starts
	// on the golden's week start day, in local time.
	const wsm = result.project.weekStartsMonday;
	let compared = 0;
	if (typeof wsm === 'boolean') {
		for (const w of weeks) {
			compared++;
			const day = new Date(parseWeekStart(w).wall).getUTCDay();
			if (day !== (wsm ? 1 : 0)) add(`the week of ${w} starts on weekday ${day}; the golden's weekStartsMonday is ${wsm}`);
		}
	}
	const seen = new Set();
	for (const row of rows) {
		const key = `${row.scenario}\n${row.id}`;
		const e = expected.get(key);
		if (!e) {
			add(`report row ${row.scenario} / ${row.id} names no resource and active scenario of the golden`);
			continue;
		}
		seen.add(key);
		const label = `${row.scenario} / ${row.id}`;
		e.plain.forEach((v, j) => {
			compared++;
			if (!same(v, row.plain[j] ?? NaN)) {
				add(`${label}, week of ${weeks[j]}: effort ${row.plain[j]} h natively, golden bookings x efficiency ${v} h`);
			}
		});
		e.cells.forEach((v, c) => {
			const period = c === 0 ? `frame ${start} to ${result.project?.end}`
				: `week of ${weeks[c - 1]} (${minutesToIso(start, (ranges.weeks[c - 1]?.[0] ?? 0) * ranges.res)})`;
			v.forEach((x, q) => {
				compared++;
				const got = row.cells[c]?.[q] ?? NaN;
				if (!same(x, got)) add(`${label}, ${period}: ${LOAD_QUERIES[q]} ${got} h natively, golden ${x} h`);
			});
		});
	}
	for (const key of expected.keys()) {
		if (!seen.has(key)) add(`no report row for ${key.replace('\n', ' / ')}`);
	}
	return { problems, rows: rows.length, weeks: weeks.length, compared };
}
