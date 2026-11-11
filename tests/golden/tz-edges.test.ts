// SPDX-License-Identifier: GPL-2.0-or-later
// Unit tests for engine/golden/tz-edges.mjs and the DST edge-case table it checks
// (engine/golden/tz-edge-cases.json). The native and wasm checks themselves need Ruby or the
// built engine (tz-edges.mjs, run-wasm.mjs); these tests cover the table and the pure helpers.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	TZ_EDGE_KINDS,
	loadTzEdgeCases,
	nativeTzEdgeDiffs,
	tzEdgeDiffs,
	tzEdgePlans,
	tzEdgeProblems,
} from '../../engine/golden/tz-edges.mjs';

interface EdgeCase {
	zone: string;
	local: string;
	utc: string;
	kind: string;
}

const cases: EdgeCase[] = loadTzEdgeCases();
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
});

describe('tzEdgeProblems', () => {
	const good = {
		zone: 'America/New_York',
		local: '2026-03-08-02:00',
		utc: '2026-03-08T07:00:00Z',
		kind: 'gap',
	};

	it('accepts a good case and every kind', () => {
		for (const kind of TZ_EDGE_KINDS)
			expect(tzEdgeProblems({ cases: [{ ...good, kind }] })).toEqual([]);
		expect(tzEdgeProblems({ cases: [{ ...good, zone: 'UTC' }] })).toEqual([]);
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
		const problems = tzEdgeProblems({ cases: [{ ...good, ...change }] });
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain(reason);
	});

	it('rejects duplicates and an empty or missing list', () => {
		expect(
			tzEdgeProblems({ cases: [good, { ...good, utc: '2026-03-08T06:00:00Z' }] })[0],
		).toContain('duplicate');
		expect(tzEdgeProblems({ cases: [] })).toEqual(['cases must be a non-empty array']);
		expect(tzEdgeProblems(null)).toEqual(['cases must be a non-empty array']);
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

describe('nativeTzEdgeDiffs', () => {
	const [a, b] = cases as [EdgeCase, EdgeCase];
	const two = [a, b];
	const first = { zone: a.zone, local: a.local, utc: a.utc };
	const second = { zone: b.zone, local: b.local, utc: b.utc };

	it('compares results in table order', () => {
		expect(nativeTzEdgeDiffs(two, [first, second])).toEqual([]);
		expect(
			nativeTzEdgeDiffs(two, [first, { ...second, utc: '2000-01-01T00:00:00Z' }]),
		).toHaveLength(1);
		const failed = { zone: b.zone, local: b.local, error: 'TjException: x' };
		expect(nativeTzEdgeDiffs(two, [first, failed])[0]).toContain('TjException: x');
		expect(nativeTzEdgeDiffs(two, [first])[0]).toContain('expected 2 native results');
		expect(nativeTzEdgeDiffs(two, [second, first])[0]).toContain('result 0 is for');
	});
});
