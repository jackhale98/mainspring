// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { EngineError } from '../../engine/protocol';
import type { TjpDiagnostic } from '../tjp/diagnostics-types';
import {
	defaultTimers,
	IDLE_TIMEOUT_MS,
	type RunRecord,
	type ScheduleCheck,
	type ScheduleChecker,
} from './run-types';
import type { WorkspaceSnapshot } from './workspace';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('defaultTimers', () => {
	it('keeps what is given', () => {
		const given = {
			setTimeout: () => 1,
			clearTimeout: () => {},
			requestIdle: () => 2,
			cancelIdle: () => {},
			now: () => 3,
		};
		expect(defaultTimers(given)).toEqual(given);
	});

	it('falls back to a zero timeout without requestIdleCallback or frames, through a given setTimeout', () => {
		vi.stubGlobal('requestIdleCallback', undefined);
		vi.stubGlobal('requestAnimationFrame', undefined);
		const calls: number[] = [];
		const cleared: unknown[] = [];
		const t = defaultTimers({
			setTimeout: (_fn, ms) => {
				calls.push(ms);
				return 7;
			},
			clearTimeout: (h) => cleared.push(h),
		});
		const h = t.requestIdle(() => {}, IDLE_TIMEOUT_MS);
		expect(calls).toEqual([0]);
		t.cancelIdle(h);
		expect(cleared).toEqual([7]);
	});

	it('falls back to a zero timeout after the next frame where there are frames (Safari)', () => {
		vi.stubGlobal('requestIdleCallback', undefined);
		const frames: Array<() => void> = [];
		const cancelledFrames: number[] = [];
		let id = 0;
		vi.stubGlobal('requestAnimationFrame', (fn: () => void) => {
			frames.push(fn);
			return ++id;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => cancelledFrames.push(id));
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const t = defaultTimers({});
		const ran: string[] = [];
		t.requestIdle(() => ran.push('a'), IDLE_TIMEOUT_MS);
		vi.advanceTimersByTime(100);
		expect(ran).toEqual([]);
		frames.shift()?.();
		expect(ran).toEqual([]);
		vi.advanceTimersByTime(0);
		expect(ran).toEqual(['a']);
		// Cancelled before its frame, and after its frame but before its timeout.
		const b = t.requestIdle(() => ran.push('b'), IDLE_TIMEOUT_MS);
		t.cancelIdle(b);
		expect(cancelledFrames).toEqual([2]);
		frames.shift()?.();
		const c = t.requestIdle(() => ran.push('c'), IDLE_TIMEOUT_MS);
		frames.shift()?.();
		t.cancelIdle(c);
		vi.advanceTimersByTime(10);
		expect(ran).toEqual(['a']);
	});

	it('uses requestIdleCallback with the timeout where there is one', () => {
		const seen: Array<number | undefined> = [];
		const cancelled: unknown[] = [];
		vi.stubGlobal('requestIdleCallback', (fn: () => void, o?: { timeout?: number }) => {
			seen.push(o?.timeout);
			fn();
			return 5;
		});
		vi.stubGlobal('cancelIdleCallback', (h: unknown) => cancelled.push(h));
		const t = defaultTimers({});
		let ran = false;
		expect(t.requestIdle(() => (ran = true), IDLE_TIMEOUT_MS)).toBe(5);
		t.cancelIdle(5);
		expect([ran, seen, cancelled]).toEqual([true, [IDLE_TIMEOUT_MS], [5]]);
	});

	it('uses the global timers at call time, so fake timers apply', () => {
		vi.stubGlobal('requestIdleCallback', undefined);
		vi.stubGlobal('requestAnimationFrame', undefined);
		const t = defaultTimers({});
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		let n = 0;
		t.setTimeout(() => n++, 10);
		const h = t.requestIdle(() => (n += 10), IDLE_TIMEOUT_MS);
		t.cancelIdle(h);
		t.requestIdle(() => (n += 100), IDLE_TIMEOUT_MS);
		vi.advanceTimersByTime(10);
		expect(n).toBe(101);
		expect(t.now()).toBeGreaterThanOrEqual(0);
	});
});

describe('the schedule check of a commit (phase-4.md 6.5)', () => {
	it('fixes `checked`, which T7 adds to the runner (`npm run typecheck` enforces it)', () => {
		expectTypeOf<ScheduleChecker['checked']>().toEqualTypeOf<
			(version: number, signal?: AbortSignal) => Promise<ScheduleCheck | null>
		>();
		expectTypeOf<ScheduleCheck['snapshot']>().toEqualTypeOf<WorkspaceSnapshot>();
		expectTypeOf<ScheduleCheck['errors']>().toEqualTypeOf<readonly TjpDiagnostic[]>();
		expectTypeOf<ScheduleCheck['record']>().toEqualTypeOf<RunRecord | null>();
		expectTypeOf<ScheduleCheck['failure']>().toEqualTypeOf<EngineError | null>();
		expectTypeOf<keyof ScheduleCheck>().toEqualTypeOf<
			'version' | 'snapshot' | 'ok' | 'errors' | 'record' | 'failure'
		>();
	});
});
