// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Latest-wins schedule queue (phase-0 spec 3.3, rules 1 to 7).
 *
 * Pure state machine: no DOM, no Worker, no timers, no promises. The client (client.ts) feeds it
 * one event per method call and carries out the returned effects in order: `post` sends a message
 * to the worker, `settle` resolves a schedule promise, `syntax-settle` settles a syntax promise.
 * Every schedule revision gets exactly one `settle` effect over the queue's lifetime.
 *
 * Interpretations of the spec, so they are not silent:
 * - "Posted at once" (rule 3) means once the worker is ready. While the worker boots or reboots,
 *   requests wait in the single pending slot, so only the newest one runs after `ready`.
 * - A cancelled request always settles `cancelled`, even if its run then fails or the worker
 *   crashes (rule 5 wins over rule 6 for requests the caller has already given up on).
 * - Rule 4's stale check: the in-flight revision is always newer than the last delivered one
 *   (requests increase and run one at a time), so a result is stale exactly when it is not for
 *   the in-flight revision. Such results, and failures for unknown revisions, are ignored.
 * - The queue never emits a `cancel` message. Pending requests live here, not in the worker, and
 *   the worker has no reply for a skipped request, so cancelling in the worker would leave the
 *   in-flight slot waiting for a result that never comes.
 */
import type {
	EngineError,
	Revision,
	ScheduleRequest,
	ScheduleResult,
	SyntaxDocs,
	ToWorker,
} from './protocol';

export type ScheduleOutcome =
	/** `latest` is false when a newer revision is pending. */
	| { status: 'done'; result: ScheduleResult; latest: boolean }
	| { status: 'superseded'; revision: Revision; by: Revision }
	| { status: 'cancelled'; revision: Revision }
	| { status: 'failed'; revision: Revision; error: EngineError };

export type EngineState = 'booting' | 'idle' | 'busy' | 'failed';

export type SyntaxOutcome = { ok: true; result: SyntaxDocs } | { ok: false; error: EngineError };

export type QueueEffect =
	| { type: 'post'; message: ToWorker }
	| { type: 'settle'; revision: Revision; outcome: ScheduleOutcome }
	| { type: 'syntax-settle'; id: number; outcome: SyntaxOutcome };

/** Read-only view of the queue, for the client's diagnostics and for tests. */
export interface QueueSnapshot {
	phase: QueuePhase;
	inFlight: { revision: Revision; cancelled: boolean } | null;
	pending: Revision | null;
	lastRequested: Revision | null;
	lastDelivered: Revision | null;
	syntaxWaiting: readonly number[];
	syntaxPosted: readonly number[];
}

/** `halted` and `disposed` are final. */
export type QueuePhase = 'booting' | 'ready' | 'halted' | 'disposed';

/** The error syntax requests settle with when the client is disposed. */
export const DISPOSED_ERROR: EngineError = Object.freeze({
	kind: 'internal',
	message: 'The engine client was disposed.',
});

interface InFlight {
	request: ScheduleRequest;
	cancelled: boolean;
}

type Effects = QueueEffect[];

export class ScheduleQueue {
	#phase: QueuePhase = 'booting';
	#haltError: EngineError = DISPOSED_ERROR;
	#lastRequested: Revision | null = null;
	#lastDelivered: Revision | null = null;
	#inFlight: InFlight | null = null;
	#pending: ScheduleRequest | null = null;
	/** Syntax ids not yet posted because the worker is not ready (rule 7). */
	#syntaxWaiting: number[] = [];
	/** Syntax ids posted and not yet answered, in posting order. */
	#syntaxPosted: number[] = [];

	get phase(): QueuePhase {
		return this.#phase;
	}

	get state(): EngineState {
		switch (this.#phase) {
			case 'booting':
				return 'booting';
			case 'ready':
				return this.hasOutstandingWork ? 'busy' : 'idle';
			case 'halted':
			case 'disposed':
				return 'failed';
		}
	}

	/** True while the worker owes a reply: a schedule in flight or a syntax request posted. */
	get hasOutstandingWork(): boolean {
		return this.#inFlight !== null || this.#syntaxPosted.length > 0;
	}

	snapshot(): QueueSnapshot {
		const inFlight = this.#inFlight;
		return {
			phase: this.#phase,
			inFlight: inFlight && {
				revision: inFlight.request.revision,
				cancelled: inFlight.cancelled,
			},
			pending: this.#pending?.revision ?? null,
			lastRequested: this.#lastRequested,
			lastDelivered: this.#lastDelivered,
			syntaxWaiting: [...this.#syntaxWaiting],
			syntaxPosted: [...this.#syntaxPosted],
		};
	}

	/**
	 * Rules 1 to 3. Throws `RangeError`, changing nothing, when the revision is not a finite number
	 * greater than every revision requested before (cancelled and superseded ones included).
	 */
	request(request: ScheduleRequest): Effects {
		const revision = request.revision;
		const last = this.#lastRequested;
		if (!Number.isFinite(revision) || (last !== null && !(revision > last))) {
			throw new RangeError(
				`Schedule revision ${revision} must be a finite number greater than ${last ?? 'none'}.`,
			);
		}
		this.#lastRequested = revision;
		if (this.#phase === 'halted') {
			return [settle(revision, { status: 'failed', revision, error: this.#haltError })];
		}
		if (this.#phase === 'disposed') {
			return [settle(revision, { status: 'cancelled', revision })];
		}
		if (this.#phase === 'ready' && this.#inFlight === null) {
			return this.#launch(request);
		}
		const superseded = this.#pending;
		this.#pending = request;
		if (superseded === null) return [];
		const old = superseded.revision;
		return [settle(old, { status: 'superseded', revision: old, by: revision })];
	}

	/** Rule 5. An unknown or already settled revision does nothing. */
	cancel(revision: Revision): Effects {
		if (this.#pending?.revision === revision) {
			this.#pending = null;
			return [settle(revision, { status: 'cancelled', revision })];
		}
		if (this.#inFlight?.request.revision === revision) {
			this.#inFlight.cancelled = true;
		}
		return [];
	}

	/** Rule 4: the worker finished a schedule. */
	result(result: ScheduleResult): Effects {
		const slot = this.#takeInFlight(result.revision);
		if (slot === null) return [];
		const revision = result.revision;
		const effects: Effects = [];
		if (slot.cancelled) {
			effects.push(settle(revision, { status: 'cancelled', revision }));
		} else {
			this.#lastDelivered = revision;
			const latest = this.#pending === null;
			effects.push(settle(revision, { status: 'done', result, latest }));
		}
		return effects.concat(this.#advance());
	}

	/** The worker reported a failure for a schedule and stays usable (not a crash). */
	failed(revision: Revision, error: EngineError): Effects {
		const slot = this.#takeInFlight(revision);
		if (slot === null) return [];
		return [this.#settleLost(slot, error), ...this.#advance()];
	}

	/** Rule 7: syntax requests skip the latest-wins slot and are posted FIFO. */
	syntax(id: number): Effects {
		if (this.#phase === 'halted') return [syntaxFail(id, this.#haltError)];
		if (this.#phase === 'disposed') return [syntaxFail(id, DISPOSED_ERROR)];
		if (this.#phase === 'booting') {
			this.#syntaxWaiting.push(id);
			return [];
		}
		this.#syntaxPosted.push(id);
		return [{ type: 'post', message: { type: 'syntax', id } }];
	}

	syntaxResult(id: number, result: SyntaxDocs): Effects {
		if (!removeId(this.#syntaxPosted, id)) return [];
		return [{ type: 'syntax-settle', id, outcome: { ok: true, result } }];
	}

	syntaxFailed(id: number, error: EngineError): Effects {
		if (!removeId(this.#syntaxPosted, id)) return [];
		return [syntaxFail(id, error)];
	}

	/** The worker booted. Waiting syntax requests go first, then the pending schedule. */
	ready(): Effects {
		if (this.#phase !== 'booting') return [];
		this.#phase = 'ready';
		const effects: Effects = [];
		for (const id of this.#syntaxWaiting) {
			this.#syntaxPosted.push(id);
			effects.push({ type: 'post', message: { type: 'syntax', id } });
		}
		this.#syntaxWaiting = [];
		return effects.concat(this.#advance());
	}

	/**
	 * Rule 6: the worker crashed or timed out. The in-flight request and posted syntax requests
	 * fail; the pending request waits for the restarted worker's `ready`.
	 */
	crashed(error: EngineError): Effects {
		if (this.#phase !== 'ready' && this.#phase !== 'booting') return [];
		this.#phase = 'booting';
		return this.#failOutstanding(error);
	}

	/** The worker cannot be (re)started. Everything fails now and every later request fails. */
	halt(error: EngineError): Effects {
		if (this.#phase === 'halted' || this.#phase === 'disposed') return [];
		this.#phase = 'halted';
		this.#haltError = error;
		const effects = this.#failOutstanding(error);
		const pending = this.#pending;
		this.#pending = null;
		if (pending !== null) {
			const revision = pending.revision;
			effects.push(settle(revision, { status: 'failed', revision, error }));
		}
		for (const id of this.#syntaxWaiting) effects.push(syntaxFail(id, error));
		this.#syntaxWaiting = [];
		return effects;
	}

	/** The client is going away: schedules settle `cancelled`, syntax requests fail. */
	dispose(): Effects {
		if (this.#phase === 'disposed') return [];
		this.#phase = 'disposed';
		const effects: Effects = [];
		for (const request of [this.#inFlight?.request, this.#pending]) {
			if (request) {
				const revision = request.revision;
				effects.push(settle(revision, { status: 'cancelled', revision }));
			}
		}
		this.#inFlight = null;
		this.#pending = null;
		for (const id of [...this.#syntaxPosted, ...this.#syntaxWaiting]) {
			effects.push(syntaxFail(id, DISPOSED_ERROR));
		}
		this.#syntaxPosted = [];
		this.#syntaxWaiting = [];
		return effects;
	}

	#launch(request: ScheduleRequest): Effects {
		this.#inFlight = { request, cancelled: false };
		return [{ type: 'post', message: { type: 'schedule', request } }];
	}

	/** Rule 4, last step: post the pending request if the worker is free. */
	#advance(): Effects {
		const pending = this.#pending;
		if (this.#phase !== 'ready' || this.#inFlight !== null || pending === null) return [];
		this.#pending = null;
		return this.#launch(pending);
	}

	#takeInFlight(revision: Revision): InFlight | null {
		const slot = this.#inFlight;
		if (slot === null || slot.request.revision !== revision) return null;
		this.#inFlight = null;
		return slot;
	}

	#settleLost(slot: InFlight, error: EngineError): QueueEffect {
		const revision = slot.request.revision;
		return slot.cancelled
			? settle(revision, { status: 'cancelled', revision })
			: settle(revision, { status: 'failed', revision, error });
	}

	#failOutstanding(error: EngineError): Effects {
		const effects: Effects = [];
		const slot = this.#inFlight;
		this.#inFlight = null;
		if (slot !== null) effects.push(this.#settleLost(slot, error));
		for (const id of this.#syntaxPosted) effects.push(syntaxFail(id, error));
		this.#syntaxPosted = [];
		return effects;
	}
}

function settle(revision: Revision, outcome: ScheduleOutcome): QueueEffect {
	return { type: 'settle', revision, outcome };
}

function syntaxFail(id: number, error: EngineError): QueueEffect {
	return { type: 'syntax-settle', id, outcome: { ok: false, error } };
}

function removeId(ids: number[], id: number): boolean {
	const index = ids.indexOf(id);
	if (index < 0) return false;
	ids.splice(index, 1);
	return true;
}
