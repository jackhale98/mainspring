// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DrivingAnalysis } from '../schedule/critical';
import { at, dep, plan } from '../schedule/testing';
import {
	ANALYSIS_MEASURE,
	analyseWhenIdle,
	analysisOf,
	whenIdle,
	type Scheduler,
} from './analysis';

/** A scheduler that runs tasks only when told to. */
function manual(): Scheduler & { flush(): void; pending(): number } {
	const tasks = new Set<() => void>();
	const schedule: Scheduler = (task) => {
		tasks.add(task);
		return () => {
			tasks.delete(task);
		};
	};
	return Object.assign(schedule, {
		flush(): void {
			for (const t of [...tasks]) {
				tasks.delete(t);
				t();
			}
		},
		pending: (): number => tasks.size,
	});
}

const chain = () =>
	plan([
		['a', { start: at(0, 9), end: at(0, 17) }],
		['b', { start: at(1, 9), end: at(1, 17), depends: [dep('a')] }],
	]);

describe('analyseWhenIdle', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		performance.clearMeasures(ANALYSIS_MEASURE);
	});

	it('computes the analysis in a scheduled task, not at once', () => {
		const s = manual();
		const got: Array<DrivingAnalysis | null> = [];
		analyseWhenIdle(chain(), (a) => got.push(a), s);
		expect(got).toEqual([]);
		expect(s.pending()).toBe(1);
		s.flush();
		expect(got).toHaveLength(1);
		expect([...(got[0]?.critical ?? [])].sort()).toEqual(['a', 'b']);
	});

	it('can be cancelled before it runs', () => {
		const s = manual();
		const done = vi.fn();
		const cancel = analyseWhenIdle(chain(), done, s);
		cancel();
		s.flush();
		expect(done).not.toHaveBeenCalled();
	});

	it('computes once per result, and answers at once from the cache', () => {
		const r = chain();
		const first = analysisOf(r);
		expect(analysisOf(r)).toBe(first);
		const s = manual();
		const done = vi.fn();
		analyseWhenIdle(r, done, s);
		expect(s.pending()).toBe(0);
		expect(done).toHaveBeenCalledWith(first);
	});

	it('records each computation as a performance measure with the task count', () => {
		analysisOf(chain());
		const entries = performance.getEntriesByName(ANALYSIS_MEASURE) as PerformanceMeasure[];
		expect(entries.length).toBeGreaterThan(0);
		expect((entries.at(-1)?.detail as { tasks: number }).tasks).toBe(2);
	});

	it('is null for a result without a project', () => {
		expect(analysisOf({ ...chain(), project: null })).toBeNull();
	});

	it('uses requestIdleCallback with a timeout, and a timeout without it', () => {
		const ric = vi.fn((_cb: IdleRequestCallback, _o?: IdleRequestOptions) => 7);
		const cic = vi.fn();
		vi.stubGlobal('requestIdleCallback', ric);
		vi.stubGlobal('cancelIdleCallback', cic);
		const cancel = whenIdle(() => undefined);
		expect(ric).toHaveBeenCalledWith(expect.any(Function), { timeout: 200 });
		cancel();
		expect(cic).toHaveBeenCalledWith(7);
		vi.unstubAllGlobals();
		vi.stubGlobal('requestIdleCallback', undefined);
		vi.useFakeTimers();
		const task = vi.fn();
		whenIdle(task);
		vi.runAllTimers();
		expect(task).toHaveBeenCalled();
		vi.useRealTimers();
	});
});
