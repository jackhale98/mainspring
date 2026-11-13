// SPDX-License-Identifier: GPL-2.0-or-later
// Unit tests for canonical.ts and compare.ts, using real goldens as the "worker result".
import { describe, expect, it } from 'vitest';
import type { ScheduleResult } from '../../src/engine/protocol';
import { canonical, canonicalJson } from './canonical';
import { annotateMinutes, compareWithGolden } from './compare';
import { loadCorpus, type GoldenFile } from './corpus';

const corpus = loadCorpus();
const byId = (id: string): GoldenFile => {
	const entry = corpus.find((e) => e.plan.id === id);
	if (!entry) throw new Error(`no golden ${id}`);
	return entry.golden;
};

/** A deep copy of a golden's result as a worker result, with revision and timings added. */
function asResult(golden: GoldenFile): ScheduleResult {
	const copy = JSON.parse(JSON.stringify(golden.result)) as Omit<
		ScheduleResult,
		'revision' | 'timings'
	>;
	return {
		...copy,
		revision: 7,
		timings: { writeFsMs: 1, parseMs: 2, scheduleMs: 3, serializeMs: 4, totalMs: 10 },
	};
}

describe('canonicalJson', () => {
	it('sorts keys recursively, indents by two and ends with a newline', () => {
		expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: null } })).toBe(
			'{\n  "a": {\n    "c": null,\n    "d": [\n      {\n        "y": 2,\n        "z": 1\n      }\n    ]\n  },\n  "b": 1\n}\n',
		);
	});

	it('keeps array order and is independent of key order', () => {
		expect(canonicalJson({ x: [3, 1, 2], y: 1 })).toBe(canonicalJson({ y: 1, x: [3, 1, 2] }));
		expect(canonical([{ b: 1, a: 2 }])).toEqual([{ a: 2, b: 1 }]);
		expect(canonicalJson({ x: [3, 1, 2] })).not.toBe(canonicalJson({ x: [1, 2, 3] }));
	});

	it('reproduces every committed golden byte for byte', () => {
		for (const { golden } of corpus.slice(0, 5)) {
			expect(canonicalJson(JSON.parse(JSON.stringify(golden)))).toBe(canonicalJson(golden));
		}
	});
});

describe('compareWithGolden', () => {
	it('accepts an identical result, ignoring revision, timings and key order', () => {
		const golden = byId('upstream-tutorial');
		const result = asResult(golden);
		expect(compareWithGolden(golden, result)).toEqual({ ok: true, diffs: [] });
		const reordered = Object.fromEntries(
			Object.entries(result).reverse(),
		) as unknown as ScheduleResult;
		expect(compareWithGolden(golden, reordered).ok).toBe(true);
	});

	it('fails on a one-minute mutation and names the path with ISO times', () => {
		const golden = byId('upstream-tutorial');
		const result = asResult(golden);
		const task = result.tasks.find((t) => Object.values(t.scenarios).some((s) => s.start !== null));
		if (!task) throw new Error('no scheduled task in golden');
		const [scenarioId, scenario] =
			Object.entries(task.scenarios).find(([, s]) => s.start !== null) ?? [];
		if (!scenarioId || !scenario || scenario.start === null) throw new Error('no start');
		const original = scenario.start;
		scenario.start = original + 1;

		const comparison = compareWithGolden(golden, result);
		expect(comparison.ok).toBe(false);
		const line =
			comparison.diffs.find((d) => d.includes(`/${task.id}/`) || d.includes('/start')) ?? '';
		expect(line).toContain(`/scenarios/${scenarioId}/start`);
		expect(line).toContain(`expected ${original} (`);
		expect(line).toContain(`got ${original + 1} (`);
		expect(line).toMatch(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\), got/);
	});

	it('fails on a one-minute mutation of a booking interval', () => {
		const golden = byId('upstream-tutorial');
		const result = asResult(golden);
		const booking = result.bookings[0];
		if (!booking?.intervals[0]) throw new Error('no booking in golden');
		booking.intervals[0][1] += 1;
		const comparison = compareWithGolden(golden, result);
		expect(comparison.ok).toBe(false);
		expect(comparison.diffs[0]).toContain('/bookings/0/intervals/0/1');
	});

	it('fails on a message text mutation', () => {
		const withMessages = corpus.find((e) => e.golden.result.messages.length > 0);
		if (!withMessages) throw new Error('no golden with messages');
		const result = asResult(withMessages.golden);
		const message = result.messages[0];
		if (!message) throw new Error('no message');
		message.text = `${message.text}.`;
		const comparison = compareWithGolden(withMessages.golden, result);
		expect(comparison.ok).toBe(false);
		expect(comparison.diffs.join('\n')).toContain('/messages/0/text');
	});

	it('fails when a task is missing and when ok flips', () => {
		const golden = byId('upstream-tutorial');
		const missing = asResult(golden);
		missing.tasks.pop();
		expect(compareWithGolden(golden, missing).ok).toBe(false);
		const flipped = asResult(golden);
		flipped.ok = !flipped.ok;
		expect(compareWithGolden(golden, flipped).diffs[0]).toContain('/ok');
	});

	it('fails on a mutation of each schema v2 field', () => {
		const golden = byId('upstream-fedora-20');
		const mutations: Array<[string, (r: ScheduleResult) => void]> = [
			[
				'/project/dailyWorkingHours',
				(r) => {
					if (r.project) r.project.dailyWorkingHours += 1;
				},
			],
			[
				'/project/workingTime/0/1',
				(r) => {
					const first = r.project?.workingTime[0];
					if (first) first[1] += 60;
				},
			],
			[
				'/direction',
				(r) => {
					const s = r.tasks[0]?.scenarios['plan'];
					if (s) s.direction = s.direction === 'asap' ? 'alap' : 'asap';
				},
			],
			[
				'/complete',
				(r) => {
					const s = r.tasks[0]?.scenarios['plan'];
					if (s) s.complete = (s.complete ?? 0) + 1;
				},
			],
			[
				'/onEnd',
				(r) => {
					const dep = r.tasks.flatMap((t) => t.scenarios['plan']?.depends ?? [])[0];
					if (dep) dep.onEnd = !dep.onEnd;
				},
			],
			[
				'/gapLengthMin',
				(r) => {
					const dep = r.tasks.flatMap((t) => t.scenarios['plan']?.depends ?? [])[0];
					if (dep) dep.gapLengthMin += 60;
				},
			],
		];
		for (const [path, mutate] of mutations) {
			const result = asResult(golden);
			mutate(result);
			const comparison = compareWithGolden(golden, result);
			expect(comparison.ok, path).toBe(false);
			expect(comparison.diffs.join('\n'), path).toContain(path);
		}
	});

	it('fails with one line on a golden of another schema', () => {
		const golden = byId('upstream-tutorial');
		const comparison = compareWithGolden({ ...golden, schemaVersion: 1 }, asResult(golden));
		expect(comparison.ok).toBe(false);
		expect(comparison.diffs).toHaveLength(1);
		expect(comparison.diffs[0]).toMatch(
			/^\/schemaVersion: the golden is schema 1, .* 2; re-record/,
		);
		expect(compareWithGolden({ result: golden.result }, asResult(golden)).ok).toBe(true);
	});

	it('limits the diff to the requested number of lines', () => {
		const golden = byId('upstream-fedora-20');
		const result = asResult(golden);
		for (const task of result.tasks) {
			for (const s of Object.values(task.scenarios)) if (s.start !== null) s.start += 1;
		}
		expect(compareWithGolden(golden, result, 3).diffs.length).toBeLessThanOrEqual(3);
	});
});

describe('annotateMinutes', () => {
	it('shows ISO times for start, end and interval values only', () => {
		const start = '2026-01-05T09:00:00Z';
		expect(annotateMinutes('/tasks/0/scenarios/plan/start: expected 60, got 61', start)).toBe(
			'/tasks/0/scenarios/plan/start: expected 60 (2026-01-05T10:00:00Z), got 61 (2026-01-05T10:01:00Z)',
		);
		expect(annotateMinutes('/bookings/0/intervals/1/0: expected 0, got null', start)).toContain(
			'(2026-01-05T09:00:00Z), got null (null)',
		);
		expect(annotateMinutes('/project/workingTime/3/1: expected 540, got 600', start)).toBe(
			'/project/workingTime/3/1: expected 540 (2026-01-05T18:00:00Z), got 600 (2026-01-05T19:00:00Z)',
		);
		const gap = '/tasks/0/scenarios/plan/depends/0/gapLengthMin: expected 480, got 540';
		expect(annotateMinutes(gap, start)).toBe(gap);
		const other = '/tasks/0/criticalness: expected 1, got 2';
		expect(annotateMinutes(other, start)).toBe(other);
		const nonNumeric = '/project/start: expected "a", got "b"';
		expect(annotateMinutes(nonNumeric, start)).toBe(nonNumeric);
		expect(annotateMinutes('/tasks/0/scenarios/plan/end: expected 1, got 2', null)).toBe(
			'/tasks/0/scenarios/plan/end: expected 1, got 2',
		);
	});
});
