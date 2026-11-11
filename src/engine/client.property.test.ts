// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Property tests for the client: random interleavings of edits, cancels, worker replies, crashes
 * and timeouts against fake workers with controlled timing and fake timers.
 */
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEngineClient, type EngineClient, type ScheduleOutcome } from './client';
import type { Revision } from './protocol';
import { FakeWorker, flush, makeRequest, makeResult } from './testing/fake-worker';

const TIMEOUT = 1_000;

type Action =
	| { kind: 'request'; step: number }
	| { kind: 'bad'; back: number }
	| { kind: 'cancel'; pick: number }
	| { kind: 'answer' }
	| { kind: 'fail' }
	| { kind: 'crash-event' }
	| { kind: 'crash-message' }
	| { kind: 'timeout' }
	| { kind: 'tick'; ms: number }
	| { kind: 'boot' }
	| { kind: 'boot-fail' }
	| { kind: 'syntax' }
	| { kind: 'stale'; pick: number }
	| { kind: 'old-worker' };

const actionArb: fc.Arbitrary<Action> = fc.oneof(
	{ weight: 8, arbitrary: fc.record({ kind: fc.constant('request'), step: fc.integer({ min: 1, max: 3 }) }) },
	{ weight: 1, arbitrary: fc.record({ kind: fc.constant('bad'), back: fc.integer({ min: 0, max: 2 }) }) },
	{ weight: 3, arbitrary: fc.record({ kind: fc.constant('cancel'), pick: fc.nat() }) },
	{ weight: 8, arbitrary: fc.constant({ kind: 'answer' as const }) },
	{ weight: 2, arbitrary: fc.constant({ kind: 'fail' as const }) },
	{ weight: 1, arbitrary: fc.constant({ kind: 'crash-event' as const }) },
	{ weight: 1, arbitrary: fc.constant({ kind: 'crash-message' as const }) },
	{ weight: 1, arbitrary: fc.constant({ kind: 'timeout' as const }) },
	{ weight: 2, arbitrary: fc.record({ kind: fc.constant('tick'), ms: fc.integer({ min: 1, max: TIMEOUT }) }) },
	{ weight: 4, arbitrary: fc.constant({ kind: 'boot' as const }) },
	{ weight: 1, arbitrary: fc.constant({ kind: 'boot-fail' as const }) },
	{ weight: 2, arbitrary: fc.constant({ kind: 'syntax' as const }) },
	{ weight: 1, arbitrary: fc.record({ kind: fc.constant('stale'), pick: fc.nat() }) },
	{ weight: 1, arbitrary: fc.constant({ kind: 'old-worker' as const }) },
);

class Harness {
	readonly workers: FakeWorker[] = [];
	readonly client: EngineClient;
	readonly violations: string[] = [];
	seq = 0;
	readonly requested: Revision[] = [];
	readonly postSeq = new Map<Revision, number>();
	readonly cancelSeq = new Map<Revision, number>();
	readonly outcomes = new Map<Revision, ScheduleOutcome>();
	readonly settleCount = new Map<Revision, number>();
	readonly doneOrder: Revision[] = [];
	readonly rangeErrors: Revision[] = [];
	/** For each answered schedule: did answering it post the next schedule? */
	readonly postedOnAnswer = new Map<Revision, boolean>();
	syntaxCalls = 0;
	syntaxSettled = 0;

	constructor() {
		this.client = createEngineClient({ transport: () => this.#newWorker(), timeoutMs: TIMEOUT });
	}

	get current(): FakeWorker {
		const worker = this.workers.at(-1);
		if (!worker) throw new Error('no worker');
		return worker;
	}

	#newWorker(): FakeWorker {
		const worker = new FakeWorker();
		worker.beforePost = (message, w) => {
			if (w.terminated) this.violations.push('posted to a terminated worker');
			if (!w.booted) this.violations.push('posted before ready');
			if (message.type !== 'schedule') return;
			const revision = message.request.revision;
			if (w.schedulesInFlight > 0) this.violations.push(`two in flight at ${revision}`);
			if (this.postSeq.has(revision)) this.violations.push(`posted ${revision} twice`);
			this.postSeq.set(revision, ++this.seq);
		};
		this.workers.push(worker);
		return worker;
	}

	#track(revision: Revision, promise: Promise<ScheduleOutcome>): void {
		promise.then(
			(outcome) => {
				this.settleCount.set(revision, (this.settleCount.get(revision) ?? 0) + 1);
				this.outcomes.set(revision, outcome);
				if (outcome.status === 'done') this.doneOrder.push(outcome.result.revision);
			},
			(error: unknown) => {
				this.violations.push(`schedule ${revision} rejected: ${String(error)}`);
			},
		);
	}

	step(action: Action): void {
		const worker = this.current;
		const last = this.requested.at(-1);
		switch (action.kind) {
			case 'request': {
				const revision = (last ?? 0) + action.step;
				this.requested.push(revision);
				this.#track(revision, this.client.schedule(makeRequest(revision)));
				break;
			}
			case 'bad': {
				const revision = last === undefined ? Number.NaN : last - action.back;
				this.client.schedule(makeRequest(revision)).then(
					() => this.violations.push(`bad revision ${revision} accepted`),
					(error: unknown) => {
						if (error instanceof RangeError) this.rangeErrors.push(revision);
					},
				);
				break;
			}
			case 'cancel': {
				const revision = this.requested[action.pick % (this.requested.length + 1)] ?? -1;
				if (!this.outcomes.has(revision) && !this.cancelSeq.has(revision)) {
					this.cancelSeq.set(revision, ++this.seq);
				}
				this.client.cancel(revision);
				break;
			}
			case 'answer':
				if (worker.booted) this.#answer(worker);
				break;
			case 'fail':
				if (worker.booted) worker.failNext();
				break;
			case 'crash-event':
				if (worker.booted) worker.emitError('error', 'RuntimeError: unreachable');
				break;
			case 'crash-message':
				if (worker.booted) worker.emit({ type: 'failed', error: { kind: 'crash', message: 'oom' } });
				break;
			case 'timeout':
				vi.advanceTimersByTime(TIMEOUT);
				break;
			case 'tick':
				vi.advanceTimersByTime(action.ms);
				break;
			case 'boot':
				if (!worker.booted && !worker.terminated) worker.boot();
				break;
			case 'boot-fail':
				if (!worker.booted) worker.emit({ type: 'failed', error: { kind: 'boot', message: 'x' } });
				break;
			case 'syntax':
				this.syntaxCalls++;
				this.client.syntax().then(
					() => this.syntaxSettled++,
					() => this.syntaxSettled++,
				);
				break;
			case 'stale': {
				const settled = [...this.outcomes.keys()];
				const revision = settled[action.pick % Math.max(settled.length, 1)];
				if (revision !== undefined) worker.emit({ type: 'scheduled', result: makeResult(revision) });
				break;
			}
			case 'old-worker':
				for (const old of this.workers.slice(0, -1)) {
					old.answerNext();
					old.emitError();
				}
				break;
		}
	}

	#answer(worker: FakeWorker): void {
		const next = worker.unanswered[0];
		const before = this.seq;
		worker.answerNext();
		if (next?.type === 'schedule') this.postedOnAnswer.set(next.request.revision, this.seq > before);
	}

	/** Lets the engine finish everything it owes. */
	drain(): void {
		for (let i = 0; i < 500 && this.client.state !== 'failed'; i++) {
			const worker = this.current;
			if (!worker.booted) worker.boot();
			else if (worker.unanswered.length > 0) this.#answer(worker);
			else return;
		}
	}
}

let harness: Harness | null = null;

afterEach(() => {
	harness?.client.dispose();
	harness = null;
	vi.useRealTimers();
});

describe('EngineClient properties', () => {
	it('settles every request once and keeps the latest-wins invariants under crashes and timeouts', async () => {
		await fc.assert(
			fc.asyncProperty(fc.array(actionArb, { maxLength: 50 }), async (actions) => {
				vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
				const h = new Harness();
				harness = h;
				try {
					for (const action of actions) {
						h.step(action);
						await flush();
					}
					h.drain();
					await flush();

					expect(h.violations).toEqual([]);
					// Every schedule promise settles exactly once.
					for (const revision of h.requested) expect(h.settleCount.get(revision)).toBe(1);
					expect(h.syntaxSettled).toBe(h.syntaxCalls);

					// `done` revisions strictly increase across deliveries.
					for (let i = 1; i < h.doneOrder.length; i++) {
						expect(h.doneOrder[i]).toBeGreaterThan(h.doneOrder[i - 1] ?? -Infinity);
					}

					// Superseded and cancelled-while-pending requests never reach the worker.
					for (const [revision, outcome] of h.outcomes) {
						const posted = h.postSeq.get(revision);
						if (outcome.status === 'superseded') expect(posted).toBeUndefined();
						if (outcome.status === 'cancelled' && posted !== undefined) {
							expect(posted).toBeLessThan(h.cancelSeq.get(revision) ?? -1);
						}
						if (outcome.status === 'done') expect(posted).toBeDefined();
						if (outcome.status === 'done') {
							// latest=false exactly when a newer request was waiting and got posted next.
							expect(outcome.latest).toBe(!h.postedOnAnswer.get(revision));
							if (!outcome.latest) expect(h.requested.some((r) => r > revision)).toBe(true);
						}
					}

					// Cancelled-while-open requests end cancelled; the newest open one ends done or failed.
					for (const revision of h.cancelSeq.keys()) {
						if (h.requested.includes(revision)) {
							expect(h.outcomes.get(revision)?.status).toBe('cancelled');
						}
					}
					const newest = h.requested.at(-1);
					if (newest !== undefined && !h.cancelSeq.has(newest)) {
						expect(['done', 'failed']).toContain(h.outcomes.get(newest)?.status);
					}

					// Every non-increasing revision was rejected with RangeError.
					const bad = actions.filter((a) => a.kind === 'bad').length;
					expect(h.rangeErrors).toHaveLength(bad);

					expect(['idle', 'failed']).toContain(h.client.state);
					expect(vi.getTimerCount()).toBe(0);
				} finally {
					h.client.dispose();
					harness = null;
					vi.useRealTimers();
				}
			}),
			{ numRuns: 200 },
		);
	});
});
