// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Property tests for the pure queue: random event sequences against a model serial worker.
 * The model checks every effect as it is emitted, then drains the queue and checks the ends.
 * Sequences are 20 to 80 events long; a final `halt` or `dispose` is rare and lands near the
 * end, so most runs exercise long interleavings of edits, replies, cancels and crashes.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { EngineError, Revision, ToWorker } from './protocol';
import { ScheduleQueue, type QueueEffect, type ScheduleOutcome } from './queue';
import { SYNTAX, makeRequest, makeResult } from './testing/fake-worker';

const BRIDGE: EngineError = { kind: 'internal', message: 'bridge exception' };
const CRASH: EngineError = { kind: 'crash', message: 'wasm trap' };
const HALT: EngineError = { kind: 'boot', message: 'cannot restart' };

type Action =
	| { kind: 'request'; step: number }
	| { kind: 'bad'; back: number }
	| { kind: 'cancel'; recent: boolean; pick: number }
	| { kind: 'complete' }
	| { kind: 'fail' }
	| { kind: 'duplicate'; pick: number }
	| { kind: 'crash' }
	| { kind: 'ready' }
	| { kind: 'syntax' }
	| { kind: 'halt' }
	| { kind: 'dispose' };

const actionArb: fc.Arbitrary<Action> = fc.oneof(
	{ weight: 8, arbitrary: fc.record({ kind: fc.constant('request'), step: fc.integer({ min: 1, max: 3 }) }) },
	{ weight: 1, arbitrary: fc.record({ kind: fc.constant('bad'), back: fc.integer({ min: 0, max: 3 }) }) },
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
	{ weight: 8, arbitrary: fc.constant({ kind: 'complete' as const }) },
	{ weight: 2, arbitrary: fc.constant({ kind: 'fail' as const }) },
	{ weight: 1, arbitrary: fc.record({ kind: fc.constant('duplicate'), pick: fc.nat() }) },
	{ weight: 2, arbitrary: fc.constant({ kind: 'crash' as const }) },
	{ weight: 3, arbitrary: fc.constant({ kind: 'ready' as const }) },
	{ weight: 2, arbitrary: fc.constant({ kind: 'syntax' as const }) },
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
					action: fc.constantFrom<Action>({ kind: 'halt' }, { kind: 'dispose' }),
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

class Model {
	readonly queue = new ScheduleQueue();
	booted = false;
	/** Messages the model worker has been sent and not answered, in order. */
	unanswered: ToWorker[] = [];
	readonly requested: Revision[] = [];
	readonly outcomes = new Map<Revision, ScheduleOutcome>();
	readonly settleCount = new Map<Revision, number>();
	readonly posted = new Set<Revision>();
	/** Revisions cancelled while still unsettled. */
	readonly cancelRequested = new Set<Revision>();
	/** Revisions open at `dispose`, or requested after it. */
	readonly disposedOpen = new Set<Revision>();
	disposed = false;
	readonly doneOrder: Revision[] = [];
	readonly syntaxSettled = new Map<number, number>();
	nextSyntaxId = 1;

	apply(effects: QueueEffect[]): void {
		for (const effect of effects) {
			if (effect.type === 'post') this.onPost(effect.message);
			else if (effect.type === 'settle') this.onSettle(effect.revision, effect.outcome);
			else this.syntaxSettled.set(effect.id, (this.syntaxSettled.get(effect.id) ?? 0) + 1);
		}
	}

	onPost(message: ToWorker): void {
		expect(this.booted, 'never post before ready').toBe(true);
		expect(message.type, 'the queue never posts cancel').not.toBe('cancel');
		if (message.type === 'schedule') {
			const revision = message.request.revision;
			expect(this.unanswered.some((m) => m.type === 'schedule'), 'one in flight').toBe(false);
			expect(this.outcomes.has(revision), 'never post a settled request').toBe(false);
			expect(this.cancelRequested.has(revision), 'never post a cancelled request').toBe(false);
			expect(this.posted.has(revision), 'post each revision once').toBe(false);
			this.posted.add(revision);
		}
		this.unanswered.push(message);
	}

	onSettle(revision: Revision, outcome: ScheduleOutcome): void {
		expect(this.requested).toContain(revision);
		this.settleCount.set(revision, (this.settleCount.get(revision) ?? 0) + 1);
		expect(this.outcomes.has(revision), 'settle exactly once').toBe(false);
		if (outcome.status === 'done') {
			expect(outcome.result.revision).toBe(revision);
			expect(this.posted.has(revision)).toBe(true);
			const last = this.doneOrder.at(-1);
			if (last !== undefined) expect(revision).toBeGreaterThan(last);
			this.doneOrder.push(revision);
			const othersOpen = this.requested.some((r) => r !== revision && !this.outcomes.has(r));
			expect(outcome.latest).toBe(!othersOpen);
		} else if (outcome.status === 'superseded') {
			expect(this.posted.has(revision), 'superseded requests are never posted').toBe(false);
			expect(outcome.by).toBeGreaterThan(revision);
			expect(this.requested).toContain(outcome.by);
		} else if (outcome.status === 'cancelled') {
			expect(this.expectCancelled(revision)).toBe(true);
		}
		if (outcome.status !== 'done') expect(outcome.revision).toBe(revision);
		this.outcomes.set(revision, outcome);
	}

	expectCancelled(revision: Revision): boolean {
		return this.cancelRequested.has(revision) || this.disposedOpen.has(revision);
	}

	step(action: Action): void {
		const q = this.queue;
		const last = this.requested.at(-1);
		switch (action.kind) {
			case 'request': {
				const revision = (last ?? 0) + action.step;
				this.requested.push(revision);
				if (this.disposed) this.disposedOpen.add(revision);
				this.apply(q.request(makeRequest(revision)));
				break;
			}
			case 'bad': {
				const before = q.snapshot();
				const revision = last === undefined ? Number.NaN : last - action.back;
				expect(() => q.request(makeRequest(revision))).toThrow(RangeError);
				expect(q.snapshot()).toEqual(before);
				break;
			}
			case 'cancel': {
				const n = this.requested.length;
				const index = action.recent ? n - 1 - action.pick : action.pick % (n + 1);
				const revision = this.requested[index] ?? -1;
				if (this.requested.includes(revision) && !this.outcomes.has(revision)) {
					this.cancelRequested.add(revision);
				}
				this.apply(q.cancel(revision));
				break;
			}
			case 'complete':
			case 'fail':
				this.answer(action.kind === 'fail');
				break;
			case 'duplicate': {
				const settled = [...this.outcomes.keys()];
				const revision = settled[action.pick % Math.max(settled.length, 1)];
				if (revision !== undefined) expect(q.result(makeResult(revision))).toEqual([]);
				break;
			}
			case 'crash':
				this.booted = false;
				this.unanswered = [];
				this.apply(q.crashed(CRASH));
				break;
			case 'ready': {
				const wasBooted = this.booted;
				const effects = q.ready();
				this.booted = q.phase === 'ready';
				if (wasBooted) expect(effects).toEqual([]);
				this.apply(effects);
				break;
			}
			case 'syntax':
				this.apply(q.syntax(this.nextSyntaxId++));
				break;
			case 'halt':
				this.booted = false;
				this.unanswered = [];
				this.apply(q.halt(HALT));
				break;
			case 'dispose':
				for (const r of this.requested) if (!this.outcomes.has(r)) this.disposedOpen.add(r);
				this.disposed = true;
				this.booted = false;
				this.unanswered = [];
				this.apply(q.dispose());
				break;
		}
		const inFlight = this.unanswered.filter((m) => m.type === 'schedule').length;
		expect(inFlight).toBeLessThanOrEqual(1);
		expect(q.snapshot().inFlight !== null).toBe(inFlight === 1);
	}

	answer(fail: boolean): void {
		const message = this.unanswered.shift();
		if (message?.type === 'schedule') {
			const revision = message.request.revision;
			this.apply(fail ? this.queue.failed(revision, BRIDGE) : this.queue.result(makeResult(revision)));
		} else if (message?.type === 'syntax') {
			const id = message.id;
			this.apply(fail ? this.queue.syntaxFailed(id, BRIDGE) : this.queue.syntaxResult(id, SYNTAX));
		}
	}

	drain(): void {
		if (this.queue.phase === 'halted' || this.queue.phase === 'disposed') return;
		if (!this.booted) this.step({ kind: 'ready' });
		while (this.unanswered.length > 0) this.answer(false);
	}
}

describe('ScheduleQueue properties', () => {
	it('keeps the latest-wins invariants for any event sequence', () => {
		const stats = { runs: 0, requests: 0 };
		fc.assert(
			fc.property(scenarioArb, (actions) => {
				const model = new Model();
				for (const action of actions) model.step(action);
				model.drain();

				// Every schedule settles exactly once; so does every syntax request.
				for (const revision of model.requested) expect(model.settleCount.get(revision)).toBe(1);
				for (let id = 1; id < model.nextSyntaxId; id++) expect(model.syntaxSettled.get(id)).toBe(1);

				// A request ends cancelled exactly when it was cancelled while open, or was open at (or
				// made after) dispose. So the newest other request ends done or failed.
				for (const revision of model.requested) {
					const cancelled = model.outcomes.get(revision)?.status === 'cancelled';
					expect(cancelled).toBe(model.expectCancelled(revision));
				}
				const newest = model.requested.at(-1);
				if (newest !== undefined && !model.expectCancelled(newest)) {
					expect(['done', 'failed']).toContain(model.outcomes.get(newest)?.status);
				}

				expect(model.queue.hasOutstandingWork).toBe(false);
				expect(['idle', 'failed']).toContain(model.queue.state);
				stats.runs++;
				stats.requests += model.requested.length;
			}),
			{ numRuns: 200 },
		);
		// Guards against a generator that stops exploring (it once averaged one request per run).
		expect(stats.requests / stats.runs).toBeGreaterThan(5);
	});
});
