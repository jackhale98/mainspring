// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleResult } from '../../engine/protocol';
import type { DrivingAnalysis } from '../schedule/critical';
import { at, dep, plan } from '../schedule/testing';
import { buildOutline } from '../state/outline';
import { buildIndex } from '../tjp/index';
import { inline } from '../tjp/index/testing';
import {
	ANALYSIS_MEASURE,
	AnalysisGate,
	NOTHING_SHOWN,
	analysisOf,
	chipOf,
	hasAnalysis,
	whenIdle,
	type Scheduler,
	type ShownAnalysis,
} from './analysis';
import { buildGanttModel } from './model';

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

/** A chain a -> b, b `shift` days later each revision (a reschedule). */
const chain = (revision: number, shift = 0): ScheduleResult => ({
	...plan([
		['a', { start: at(shift, 9), end: at(shift, 17) }],
		['b', { start: at(shift + 1, 9), end: at(shift + 1, 17), depends: [dep('a')] }],
	]),
	revision,
});

function gate(on = true) {
	const s = manual();
	const published: ShownAnalysis[] = [];
	const g = new AnalysisGate({ publish: (x) => published.push(x), schedule: s });
	g.setOn(on);
	return { g, s, published };
}

describe('AnalysisGate', () => {
	afterEach(() => {
		performance.clearMeasures(ANALYSIS_MEASURE);
	});

	it('draws the first result at once, and its analysis once the idle task runs', () => {
		const { g, s, published } = gate();
		const r1 = chain(1);
		g.offer(r1);
		expect(published).toEqual([{ result: r1, analysis: null }]);
		s.flush();
		expect(g.shown.result).toBe(r1);
		expect([...(g.shown.analysis?.critical ?? [])].sort()).toEqual(['a', 'b']);
	});

	it('with the chip on, keeps the previous pair until the new analysis is ready', () => {
		const { g, s, published } = gate();
		const [r1, r2] = [chain(1), chain(2, 1)];
		g.offer(r1);
		s.flush();
		const before = g.shown;
		g.offer(r2);
		expect(g.shown).toBe(before);
		s.flush();
		expect(g.shown.result).toBe(r2);
		expect(g.shown.analysis?.revision).toBe(2);
		// Every pair ever published belongs together.
		for (const p of published) {
			if (p.analysis) expect(p.analysis.revision).toBe(p.result?.revision);
		}
	});

	it('with the chip off, draws a new result at once', () => {
		const { g, s } = gate(false);
		const [r1, r2] = [chain(1), chain(2, 1)];
		g.offer(r1);
		s.flush();
		g.offer(r2);
		expect(g.shown).toEqual({ result: r2, analysis: null });
		s.flush();
		expect(g.shown.analysis?.revision).toBe(2);
	});

	it('turning the chip off while it waits draws the newest result at once', () => {
		const { g, s } = gate();
		const [r1, r2] = [chain(1), chain(2, 1)];
		g.offer(r1);
		s.flush();
		g.offer(r2);
		g.setOn(false);
		expect(g.shown.result).toBe(r2);
		s.flush();
		expect(g.shown.analysis?.revision).toBe(2);
	});

	it('skips a result overtaken by a newer one, and answers a cached result at once', () => {
		const { g, s } = gate();
		const [r1, r2, r3] = [chain(1), chain(2, 1), chain(3, 2)];
		g.offer(r1);
		s.flush();
		g.offer(r2);
		g.offer(r3);
		expect(s.pending()).toBe(1);
		s.flush();
		expect(hasAnalysis(r2)).toBe(false);
		expect(g.shown.result).toBe(r3);
		g.offer(r1);
		expect(g.shown.result).toBe(r1);
		expect(s.pending()).toBe(0);
		g.offer(null);
		expect(g.shown).toBe(NOTHING_SHOWN);
	});

	it('cancels the pending analysis when disposed', () => {
		const { g, s } = gate();
		g.offer(chain(1));
		g.dispose();
		expect(s.pending()).toBe(0);
	});

	it('never drops the critical rows of the model across reschedules with the chip on', () => {
		const ws = inline({
			'plan.tjp': `project p "P" 2026-01-05 +30d\ntask a "A" { effort 1d }\ntask b "B" { depends !a effort 1d }\n`,
		});
		const nodes = buildOutline(buildIndex(ws.snapshot())).tasks;
		const { g, s, published } = gate();
		const model = (p: ShownAnalysis) =>
			buildGanttModel({
				nodes,
				collapsed: new Set(),
				result: p.result,
				dimmed: false,
				links: [],
				analysis: p.analysis,
				nowMs: null,
			});
		g.offer(chain(1));
		s.flush();
		const seen: ShownAnalysis[] = [];
		for (let rev = 2; rev <= 6; rev++) {
			const start = published.length;
			g.offer(chain(rev, rev % 3));
			seen.push(g.shown); // what the Gantt draws while the analysis is computed
			s.flush();
			seen.push(...published.slice(start));
		}
		for (const p of seen) {
			const critical = model(p)
				.rows.filter((r) => r.critical)
				.map((r) => r.id);
			expect(critical, `revision ${p.result?.revision}`).toEqual(['a', 'b']);
		}
	});
});

describe('analysisOf', () => {
	it('records each computation as a performance measure with the task count', () => {
		const r = chain(1);
		const first = analysisOf(r);
		expect(analysisOf(r)).toBe(first);
		const entries = performance.getEntriesByName(ANALYSIS_MEASURE) as PerformanceMeasure[];
		expect((entries.at(-1)?.detail as { tasks: number }).tasks).toBe(2);
	});

	it('is null for a result without a project', () => {
		expect(analysisOf({ ...chain(1), project: null })).toBeNull();
	});

	it('reports an analysis that throws, caches null, and the gate carries on', () => {
		// A result whose tasks list cannot be read: the analysis throws.
		const broken = { ...chain(7) } as ScheduleResult;
		Object.defineProperty(broken, 'tasks', {
			get() {
				throw new Error('broken result');
			},
		});
		const onError = vi.fn();
		const s = manual();
		const published: ShownAnalysis[] = [];
		const g = new AnalysisGate({ publish: (x) => published.push(x), schedule: s, onError });
		g.offer(broken);
		s.flush();
		expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'broken result' }));
		expect(hasAnalysis(broken)).toBe(true);
		expect(g.shown).toEqual({ result: broken, analysis: null });
		expect(analysisOf(broken, onError)).toBeNull();
		expect(onError).toHaveBeenCalledTimes(1);
	});
});

describe('chipOf', () => {
	const fake = (critical: string[], path: string[]): DrivingAnalysis =>
		({ critical: new Set(critical), path: new Set(path) }) as unknown as DrivingAnalysis;

	it('is unavailable and says why without an analysis', () => {
		expect(chipOf(null, true)).toEqual({
			available: false,
			pressed: true,
			why: 'The critical path is not computed yet',
			note: null,
		});
	});

	it('describes the values as estimates once there is one', () => {
		const c = chipOf(fake(['a'], ['a']), true);
		expect(c.available).toBe(true);
		expect(c.why).toMatch(/estimates: they ignore resource limits/);
		expect(c.note).toBeNull();
	});

	it('notes a whole path before the status date, only while the chip is on', () => {
		expect(chipOf(fake([], ['a', 'b']), true).note).toBe(
			'Every task on the critical path ends before the status date',
		);
		expect(chipOf(fake([], ['a', 'b']), false).note).toBeNull();
		// No path at all (no tasks): nothing to explain.
		expect(chipOf(fake([], []), true).note).toBeNull();
	});
});

describe('whenIdle', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
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
	});
});
