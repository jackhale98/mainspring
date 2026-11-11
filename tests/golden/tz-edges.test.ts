// SPDX-License-Identifier: GPL-2.0-or-later
// Unit tests for engine/golden/tz-edges.mjs and the time-zone edge-case table it checks
// (engine/golden/tz-edge-cases.json: DST instants and timingresolution caps). The native and wasm checks themselves need Ruby or the
// built engine (tz-edges.mjs, run-wasm.mjs); these tests cover the table and the pure helpers.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	TZ_EDGE_KINDS,
	loadTzEdgeTable,
	nativeTzEdgeDiffs,
	tzEdgeDiffs,
	tzEdgePlans,
	tzEdgeProblems,
	tzResolutionDiffs,
	tzResolutionPlans,
} from '../../engine/golden/tz-edges.mjs';

interface EdgeCase {
	zone: string;
	local: string;
	utc: string;
	kind: string;
}

interface ResolutionCase {
	zone: string;
	maxMinutes: number;
	note?: string;
}

const table: { cases: EdgeCase[]; resolutions: ResolutionCase[] } = loadTzEdgeTable();
const { cases, resolutions } = table;
const MIN = 60_000;
const DAY = 86_400_000;

/** The local date and time as if it were UTC, in ms. */
function wallMs(local: string): number {
	const [y, mo, d, h, mi] = local.split(/[-:]/).map(Number) as [
		number,
		number,
		number,
		number,
		number,
	];
	return Date.UTC(y, mo - 1, d, h, mi);
}

const formats = new Map<string, Intl.DateTimeFormat>();
/** UTC offset of `zone` at instant `ms`, in ms (Intl; the browser engine's source too). */
function offsetMs(zone: string, ms: number): number {
	let f = formats.get(zone);
	if (!f) {
		f = new Intl.DateTimeFormat('en-US', {
			timeZone: zone,
			hourCycle: 'h23',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
		});
		formats.set(zone, f);
	}
	const p = Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, Number(x.value)]));
	return Date.UTC(p['year'] ?? 0, (p['month'] ?? 1) - 1, p['day'], p['hour'], p['minute']) - ms;
}

describe('tz-edge-cases.json', () => {
	it('is a valid table', () => {
		const table: unknown = JSON.parse(readFileSync('engine/golden/tz-edge-cases.json', 'utf8'));
		expect(tzEdgeProblems(table)).toEqual([]);
	});

	it('covers gaps and overlaps on both sides of UTC and in both hemispheres', () => {
		const zonesWith = (kind: string) =>
			new Set(cases.filter((c) => c.kind === kind).map((c) => c.zone));
		for (const zone of [
			'America/New_York',
			'America/Los_Angeles',
			'America/Santiago',
			'America/Sao_Paulo',
			'Europe/Berlin',
			'Australia/Sydney',
		]) {
			expect(zonesWith('gap').has(zone), `${zone} gap`).toBe(true);
			expect(zonesWith('overlap').has(zone), `${zone} overlap`).toBe(true);
		}
		expect(zonesWith('gap').has('Asia/Kathmandu')).toBe(true);
	});

	// The same rules as engine/bridge/wasm/tj_wasm_tz.rb, applied with Intl offsets, so the
	// table stays consistent with its stated rules in CI, where native Ruby never runs.
	it.each(cases.filter((c) => c.zone !== 'UTC'))('$zone $local is $kind', (c) => {
		const wall = wallMs(c.local);
		const utc = Date.parse(c.utc);
		const before = offsetMs(c.zone, wall - DAY);
		const after = offsetMs(c.zone, wall + DAY);
		const exists = (o: number) => offsetMs(c.zone, wall - o) === o;
		switch (c.kind) {
			case 'plain':
			case 'before':
			case 'after':
				expect(utc + offsetMs(c.zone, utc)).toBe(wall);
				expect(exists(before) && exists(after) && before !== after).toBe(false);
				break;
			case 'overlap':
				expect(before).toBeGreaterThan(after);
				expect(exists(before) && exists(after)).toBe(true);
				expect(utc).toBe(wall - after);
				break;
			case 'gap':
				expect(before).toBeLessThan(after);
				expect(exists(before) || exists(after)).toBe(false);
				expect(utc).toBe(wall - before);
				break;
			default:
				throw new Error(`unknown kind ${c.kind}`);
		}
	});

	// Project.maxScheduleGranularity: the minutes of the zone's time at 2000-01-01T00:00Z.
	it.each(resolutions)('$zone caps timingresolution at $maxMinutes min', (r) => {
		const minutes = (((offsetMs(r.zone, Date.UTC(2000, 0, 1)) / MIN) % 60) + 60) % 60;
		expect(r.maxMinutes).toBe({ 0: 60, 30: 30, 15: 15, 45: 15 }[minutes]);
	});

	it('has resolution caps of 15, 30 and 60 minutes, including Kathmandu', () => {
		expect(new Set(resolutions.map((r) => r.maxMinutes))).toEqual(new Set([15, 30, 60]));
		expect(resolutions.find((r) => r.zone === 'Asia/Kathmandu')?.maxMinutes).toBe(15);
	});
});

describe('tzEdgeProblems', () => {
	const good = {
		zone: 'America/New_York',
		local: '2026-03-08-02:00',
		utc: '2026-03-08T07:00:00Z',
		kind: 'gap',
	};

	const res = { zone: 'Asia/Kathmandu', maxMinutes: 15 };
	const of = (c: object, r: object = res) => ({ cases: [c], resolutions: [r] });

	it('accepts a good case and every kind', () => {
		for (const kind of TZ_EDGE_KINDS) expect(tzEdgeProblems(of({ ...good, kind }))).toEqual([]);
		expect(tzEdgeProblems(of({ ...good, zone: 'UTC' }))).toEqual([]);
		expect(tzEdgeProblems(of(good, { ...res, note: '+05:45' }))).toEqual([]);
	});

	it.each([
		[{ zone: 'EST' }, 'zone'],
		[{ local: '2026-02-30-02:00' }, 'real'],
		[{ local: '2026-03-08-24:00' }, 'real'],
		[{ local: '2026-03-08T02:00' }, 'real'],
		[{ local: '2036-03-08-02:00' }, '1970 to 2035'],
		[{ utc: '2026-03-08T07:00Z' }, 'ISO 8601'],
		[{ utc: '2026-03-08T07:10:00Z' }, 'quarter hour'],
		[{ kind: 'fold' }, 'kind'],
	])('rejects %j', (change, reason) => {
		const problems = tzEdgeProblems(of({ ...good, ...change }));
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain(reason);
	});

	it.each([
		[{ zone: 'IST' }, 'zone'],
		[{ maxMinutes: 45 }, 'maxMinutes'],
		[{ note: 5 }, 'note'],
	])('rejects resolution %j', (change, reason) => {
		const problems = tzEdgeProblems(of(good, { ...res, ...change }));
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain(reason);
	});

	it('rejects duplicates and an empty or missing list', () => {
		const twice = { cases: [good, { ...good, utc: '2026-03-08T06:00:00Z' }], resolutions: [res] };
		expect(tzEdgeProblems(twice)[0]).toContain('duplicate');
		expect(tzEdgeProblems({ cases: [good], resolutions: [res, res] })[0]).toContain('duplicate');
		expect(tzEdgeProblems({ cases: [], resolutions: [res] })).toEqual([
			'cases must be a non-empty array',
		]);
		expect(tzEdgeProblems({ cases: [good] })).toEqual(['resolutions must be a non-empty array']);
		expect(tzEdgeProblems(null)).toHaveLength(2);
	});
});

describe('tzEdgePlans', () => {
	const plans = tzEdgePlans(cases);

	it('puts every case in exactly one plan of its zone', () => {
		expect(plans.flatMap((p) => p.cases)).toHaveLength(cases.length);
		for (const p of plans) for (const c of p.cases) expect(c.zone).toBe(p.zone);
		// New York has three changes in the table, each far from the others.
		expect(plans.filter((p) => p.zone === 'America/New_York')).toHaveLength(3);
	});

	it('writes the frame and now before the zone, and one milestone per case inside the frame', () => {
		for (const p of plans) {
			const m =
				/project tzedges "DST edge cases" (\S+) - (\S+) \{\n {2}now (\S+)\n {2}timingresolution 15min\n {2}timezone "([^"]+)"\n\}\n/.exec(
					p.text,
				);
			expect(m, p.text).not.toBeNull();
			const [, start, end, now, zone] = m as unknown as [string, string, string, string, string];
			expect(now).toBe(start);
			expect(zone).toBe(p.zone);
			p.cases.forEach((c, i) => {
				expect(p.text).toContain(`task c${i} "${c.local}" { start ${c.local} milestone }\n`);
				expect(wallMs(c.local)).toBeGreaterThan(Date.parse(start) + DAY);
				expect(wallMs(c.local)).toBeLessThan(Date.parse(end) - DAY);
			});
		}
	});
});

describe('tzEdgeDiffs', () => {
	const plan = tzEdgePlans(
		cases.filter((c) => c.local.startsWith('2026-03-08') && c.zone === 'America/New_York'),
	)[0];
	if (!plan) throw new Error('no New York plan');
	const start = '2026-03-06T00:00:00Z';
	const tasks = (shift: number) =>
		plan.cases.map((c, i) => ({
			id: `c${i}`,
			scenarios: { plan: { start: (Date.parse(c.utc) - Date.parse(start)) / MIN + shift } },
		}));

	it('is empty when every milestone starts at its instant', () => {
		expect(
			tzEdgeDiffs(plan, { ok: true, messages: [], project: { start }, tasks: tasks(0) }),
		).toEqual([]);
	});

	it('names each case that starts elsewhere', () => {
		const diffs = tzEdgeDiffs(plan, {
			ok: true,
			messages: [],
			project: { start },
			tasks: tasks(-60),
		});
		expect(diffs).toHaveLength(plan.cases.length);
		expect(diffs).toContain(
			'America/New_York 2026-03-08-02:00 (gap): expected 2026-03-08T07:00:00Z, got 2026-03-08T06:00:00Z',
		);
	});

	it('reports every case of a plan that did not schedule', () => {
		const error = { level: 'error', id: 'start_before_end', text: 'x' };
		const diffs = tzEdgeDiffs(plan, { ok: false, messages: [error], project: null, tasks: [] });
		expect(diffs).toHaveLength(plan.cases.length);
		expect(diffs[0]).toContain('not scheduled');
	});
});

describe('tzResolutionPlans and tzResolutionDiffs', () => {
	const plans = tzResolutionPlans(resolutions);
	const byZone = (zone: string) => {
		const p = plans.find((x) => x.zone === zone);
		if (!p) throw new Error(`no plan for ${zone}`);
		return p;
	};

	it('tries the next allowed value above the cap, or 60 for a 60-minute cap', () => {
		expect(plans).toHaveLength(resolutions.length);
		expect(byZone('Asia/Kathmandu').tried).toBe(20);
		expect(byZone('Asia/Kolkata').tried).toBe(60);
		expect(byZone('America/New_York').tried).toBe(60);
		for (const p of plans) {
			expect(p.text).toContain(
				`  now 2026-01-05\n  timezone "${p.zone}"\n  timingresolution ${p.tried}min\n}\n`,
			);
			expect(p.text).toContain('task t "T" { start ${projectstart} milestone }\n');
		}
	});

	const error = (max: number) => ({
		level: 'error',
		id: 'too_large_timing_res',
		text: `The maximum allowed timing resolution for the timezone is ${max} minutes.`,
	});

	it('wants the cap error above the cap', () => {
		const p = byZone('Asia/Kathmandu');
		expect(tzResolutionDiffs(p, { ok: false, messages: [error(15)] })).toEqual([]);
		expect(tzResolutionDiffs(p, { ok: false, messages: [error(60)] })[0]).toContain('15 minutes');
		expect(
			tzResolutionDiffs(p, { ok: true, messages: [], project: { timingResolutionMin: 20 } })[0],
		).toContain('got ok true');
	});

	it('wants a schedule at a 60-minute cap', () => {
		const p = byZone('America/New_York');
		const ok = { ok: true, messages: [], project: { timingResolutionMin: 60 } };
		expect(tzResolutionDiffs(p, ok)).toEqual([]);
		expect(tzResolutionDiffs(p, { ok: false, messages: [error(30)] })).toHaveLength(1);
	});
});

describe('nativeTzEdgeDiffs', () => {
	const [a, b] = cases as [EdgeCase, EdgeCase];
	const [r] = resolutions as [ResolutionCase];
	const two = { cases: [a, b], resolutions: [r] };
	const first = { zone: a.zone, local: a.local, utc: a.utc };
	const second = { zone: b.zone, local: b.local, utc: b.utc };
	const cap = { zone: r.zone, maxMinutes: r.maxMinutes };
	type NativeCase = { zone: string; local: string; utc?: string; error?: string };
	type NativeCap = { zone: string; maxMinutes?: number; error?: string };
	const out = (c: NativeCase[], res: NativeCap[] = [cap]) => ({ cases: c, resolutions: res });

	it('compares results in table order', () => {
		expect(nativeTzEdgeDiffs(two, out([first, second]))).toEqual([]);
		const moved = { ...second, utc: '2000-01-01T00:00:00Z' };
		expect(nativeTzEdgeDiffs(two, out([first, moved]))).toHaveLength(1);
		const failed = { zone: b.zone, local: b.local, error: 'TjException: x' };
		expect(nativeTzEdgeDiffs(two, out([first, failed]))[0]).toContain('TjException: x');
		expect(nativeTzEdgeDiffs(two, out([first]))[0]).toContain('expected 2 + 1 native results');
		expect(nativeTzEdgeDiffs(two, out([second, first]))[0]).toContain('result 0 is for');
	});

	it('compares resolution caps', () => {
		const wrong = { ...cap, maxMinutes: 60 };
		expect(nativeTzEdgeDiffs(two, out([first, second], [wrong]))[0]).toContain(
			`expected ${r.maxMinutes} min, got 60`,
		);
		expect(nativeTzEdgeDiffs(two, out([first, second], [{ zone: 'UTC' }]))[0]).toContain(
			'resolution result 0 is for UTC',
		);
	});
});
