// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Property tests for the client: random interleavings of edits, cancels, worker replies, crashes,
 * timeouts and refused posts against fake workers with controlled timing and fake timers.
 * Sequences are 20 to 80 events long; a final event that ends the engine (boot failure, failed
 * restart, boot timeout, dispose) is rare and lands near the end, so a few events follow it.
 */
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEngineClient, type EngineClient, type ScheduleOutcome } from './client';
import type { Revision } from './protocol';
import { FakeWorker, flush, makeRequest, makeResult } from './testing/fake-worker';

const TIMEOUT = 1_000;
const BOOT_TIMEOUT = 60_000;

type Action =
	| { kind: 'request'; step: number }
	| { kind: 'bad'; back: number }
	| { kind: 'cancel'; recent: boolean; pick: number }
	| { kind: 'answer' }
	| { kind: 'fail' }
	| { kind: 'crash-event' }
	| { kind: 'crash-message' }
	| { kind: 'timeout' }
	| { kind: 'tick'; ms: number }
	| { kind: 'boot' }
	| { kind: 'syntax' }
	| { kind: 'stale'; pick: number }
	| { kind: 'old-worker' }
	| { kind: 'post-throws' }
	| { kind: 'boot-fail' | 'restart-fail' | 'boot-timeout' | 'dispose' };

const actionArb: fc.Arbitrary<Action> = fc.oneof(
	{
		weight: 8,
		arbitrary: fc.record({ kind: fc.constant('request'), step: fc.integer({ min: 1, max: 3 }) }),
	},
	{
		weight: 1,
		arbitrary: fc.record({ kind: fc.constant('bad'), back: fc.integer({ min: 0, max: 2 }) }),
	},
	// Cancels mostly hit the two newest revisions, the ones that can be in flight or pending.
	{
		weight: 3,
		arbitrary: fc.record({
			kind: fc.constant('cancel'),
			recent: fc.constant(true),
			pick: fc.integer({ min: 0, max: 1 }),
		}),
	},
	{
		weight: 1,
		arbitrary: fc.record({ kind: fc.constant('cancel'), recent: fc.constant(false), pick: fc.nat() }),
	},
	{ weight: 8, arbitrary: fc.constant({ kind: 'answer' as const }) },
	{ weight: 2, arbitrary: fc.constant({ kind: 'fail' as const }) },
	{ weight: 1, arbitrary: fc.constant({ kind: 'crash-event' as const }) },
	{ weight: 1, arbitrary: fc.constant({ kind: 'crash-message' as const }) },
	{ weight: 1, arbitrary: fc.constant({ kind: 'timeout' as const }) },
	{
		weight: 2,
		arbitrary: fc.record({ kind: fc.constant('tick'), ms: fc.integer({ min: 1, max: TIMEOUT }) }),
	},
	{ weight: 4, arbitrary: fc.constant({ kind: 'boot' as const }) },
	{ weight: 2, arbitrary: fc.constant({ kind: 'syntax' as const }) },
	{ weight: 1, arbitrary: fc.record({ kind: fc.constant('stale'), pick: fc.nat() }) },
	{ weight: 1, arbitrary: fc.constant({ kind: 'old-worker' as const }) },
	{ weight: 1, arbitrary: fc.constant({ kind: 'post-throws' as const }) },
);

/** Final events: absent in two runs out of three, otherwise inserted 0 to 8 events from the end. */
const scenarioArb = fc
	.record({
		actions: fc.array(actionArb, { minLength: 20, maxLength: 80, size: 'max' }),
		terminal: fc.oneof(
			{ weight: 2, arbitrary: fc.constant(null) },
			{
				weight: 1,
				arbitrary: fc.record({
					action: fc.constantFrom<Action>(
						{ kind: 'boot-fail' },
						{ kind: 'restart-fail' },
						{ kind: 'boot-timeout' },
						{ kind: 'dispose' },
					),
					fromEnd: fc.integer({ min: 0, max: 8 }),
				}),
			},
		),
	})
	.map(({ actions, terminal }) => {
		if (terminal === null) return actions;
		const at = Math.max(0, actions.length - terminal.fromEnd);
		return [...actions.slice(0, at), terminal.action, ...actions.slice(at)];
	});

class Harness {
	readonly workers: FakeWorker[] = [];
	readonly client: EngineClient;
	readonly violations: string[] = [];
	/** Orders schedule post attempts and cancel calls. */
	seq = 0;
	readonly requested: Revision[] = [];
	readonly postSeq = new Map<Revision, number>();
	readonly cancelSeq = new Map<Revision, number>();
	/** Revisions open at `dispose`, or requested after it. */
	readonly disposedOpen = new Set<Revision>();
	disposed = false;
	readonly outcomes = new Map<Revision, ScheduleOutcome>();
	readonly settleCount = new Map<Revision, number>();
	readonly doneOrder: Revision[] = [];
	readonly rangeErrors: Revision[] = [];
	/** For each answered schedule: did answering it try to post the next schedule? */
	readonly postedOnAnswer = new Map<Revision, boolean>();
	syntaxCalls = 0;
	syntaxSettled = 0;
	throwNextPost = false;
	failNextCreate = false;

	constructor() {
		this.client = createEngineClient({
			transport: () => this.#newWorker(),
			timeoutMs: TIMEOUT,
			bootTimeoutMs: BOOT_TIMEOUT,
		});
	}

	get current(): FakeWorker {
		const worker = this.workers.at(-1);
		if (!worker) throw new Error('no worker');
		return worker;
	}

	expectCancelled(revision: Revision): boolean {
		return this.cancelSeq.has(revision) || this.disposedOpen.has(revision);
	}

	#newWorker(): FakeWorker {
		if (this.failNextCreate) {
			this.failNextCreate = false;
			throw new Error('cannot create worker');
		}
		const worker = new FakeWorker();
		worker.beforePost = (message, w) => {
			if (w.terminated) this.violations.push('posted to a terminated worker');
			if (!w.booted) this.violations.push('posted before ready');
			const revision = message.type === 'schedule' ? message.request.revision : null;
			if (revision !== null) {
				if (w.schedulesInFlight > 0) this.violations.push(`two in flight at ${revision}`);
				this.seq++;
			}
			if (this.throwNextPost) {
				this.throwNextPost = false;
				throw new Error('DataCloneError');
			}
			if (revision !== null) {
				if (this.postSeq.has(revision)) this.violations.push(`posted ${revision} twice`);
				this.postSeq.set(revision, this.seq);
			}
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
				if (this.disposed) this.disposedOpen.add(revision);
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
				const n = this.requested.length;
				const index = action.recent ? n - 1 - action.pick : action.pick % (n + 1);
				const revision = this.requested[index] ?? -1;
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
			case 'post-throws':
				this.throwNextPost = true;
				break;
			case 'boot-fail':
				if (worker.booted) worker.emitError();
				this.current.emit({ type: 'failed', error: { kind: 'boot', message: 'hash mismatch' } });
				break;
			case 'restart-fail':
				this.failNextCreate = true;
				worker.emitError();
				break;
			case 'boot-timeout':
				if (worker.booted) worker.emitError();
				vi.advanceTimersByTime(BOOT_TIMEOUT);
				break;
			case 'dispose':
				for (const r of this.requested) if (!this.outcomes.has(r)) this.disposedOpen.add(r);
				this.disposed = true;
				this.client.dispose();
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
		this.throwNextPost = false;
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
		const stats = { runs: 0, requests: 0 };
		await fc.assert(
			fc.asyncProperty(scenarioArb, async (actions) => {
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
							const cancelAt = h.cancelSeq.get(revision);
							if (cancelAt !== undefined) expect(posted).toBeLessThan(cancelAt);
							else expect(h.disposedOpen.has(revision)).toBe(true);
						}
						if (outcome.status === 'done') {
							expect(posted).toBeDefined();
							// latest=false exactly when a newer request was waiting and got posted next.
							expect(outcome.latest).toBe(!h.postedOnAnswer.get(revision));
							if (!outcome.latest) expect(h.requested.some((r) => r > revision)).toBe(true);
						}
					}

					// A request ends cancelled exactly when it was cancelled while open, or was open at
					// (or made after) dispose. So the newest other request ends done or failed.
					for (const revision of h.requested) {
						const cancelled = h.outcomes.get(revision)?.status === 'cancelled';
						expect(cancelled).toBe(h.expectCancelled(revision));
					}
					const newest = h.requested.at(-1);
					if (newest !== undefined && !h.expectCancelled(newest)) {
						expect(['done', 'failed']).toContain(h.outcomes.get(newest)?.status);
					}

					// Every non-increasing revision was rejected with RangeError.
					const bad = actions.filter((a) => a.kind === 'bad').length;
					expect(h.rangeErrors).toHaveLength(bad);

					expect(['idle', 'failed']).toContain(h.client.state);
					expect(vi.getTimerCount()).toBe(0);
					stats.runs++;
					stats.requests += h.requested.length;
				} finally {
					h.client.dispose();
					harness = null;
					vi.useRealTimers();
				}
			}),
			{ numRuns: 200 },
		);
		// Guards against a generator that stops exploring (it once averaged one request per run).
		expect(stats.requests / stats.runs).toBeGreaterThan(5);
	});
});
