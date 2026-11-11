// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Test-only fake engine worker with fully controlled timing. Nothing happens until the test calls
 * one of the `answer`/`emit` methods. Not imported by application code.
 */
import type { WorkerLike } from '../client';
import type {
	EngineError,
	EngineVersions,
	FromWorker,
	Revision,
	ScheduleRequest,
	ScheduleResult,
	SyntaxDocs,
	ToWorker,
} from '../protocol';

export const VERSIONS: EngineVersions = {
	tj: '3.8.4',
	tjCommit: '3b36c799605621103d7d065c69e3f958a3dd6698',
	rubyWasm: '0.0.0-test',
	bundleHash: 'test',
};

export const SYNTAX: SyntaxDocs = { tjVersion: '3.8.4', keywords: [] };

export function makeRequest(revision: Revision): ScheduleRequest {
	return { files: { 'plan.tjp': `# revision ${revision}\n` }, entry: 'plan.tjp', revision };
}

export function makeResult(revision: Revision): ScheduleResult {
	return {
		revision,
		ok: true,
		project: null,
		tasks: [],
		resources: [],
		bookings: [],
		messages: [],
		timings: { writeFsMs: 0, parseMs: 0, scheduleMs: 0, serializeMs: 0, totalMs: 0 },
	};
}

type Listener = (event: never) => void;

export class FakeWorker implements WorkerLike {
	/** Every message posted, in order. */
	readonly posted: ToWorker[] = [];
	/** Posted schedule and syntax messages not yet answered, in posting order (the worker is serial). */
	readonly unanswered: ToWorker[] = [];
	terminated = false;
	booted = false;
	/** When set, `postMessage` throws it (simulates DataCloneError). */
	postError: Error | null = null;
	/** Called on every `postMessage`, before anything else; property tests check protocol rules here. */
	beforePost: ((message: ToWorker, worker: FakeWorker) => void) | null = null;
	readonly #listeners = new Map<string, Listener[]>();

	postMessage(message: ToWorker): void {
		this.beforePost?.(message, this);
		if (this.postError) throw this.postError;
		if (this.terminated) throw new Error('FakeWorker: postMessage after terminate');
		this.posted.push(message);
		if (message.type !== 'cancel') this.unanswered.push(message);
	}

	terminate(): void {
		this.terminated = true;
	}

	addEventListener(type: 'message', listener: (event: MessageEvent<FromWorker>) => void): void;
	addEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void;
	addEventListener(type: string, listener: Listener): void {
		this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
	}

	/** Schedules posted to this worker that have not been answered. */
	get schedulesInFlight(): number {
		return this.unanswered.filter((m) => m.type === 'schedule').length;
	}

	emit(data: FromWorker): void {
		this.#dispatch('message', new MessageEvent('message', { data }));
	}

	emitRaw(data: unknown): void {
		this.#dispatch('message', new MessageEvent('message', { data }));
	}

	emitError(type: 'error' | 'messageerror' = 'error', message?: string): void {
		const event = new Event(type);
		if (message !== undefined) Object.defineProperty(event, 'message', { value: message });
		this.#dispatch(type, event);
	}

	boot(): void {
		this.booted = true;
		this.emit({ type: 'ready', versions: VERSIONS, bootMs: 1 });
	}

	/** Answers the oldest unanswered message, as a serial worker would. Returns what it answered. */
	answerNext(): ToWorker | undefined {
		const message = this.unanswered.shift();
		if (message?.type === 'schedule') {
			this.emit({ type: 'scheduled', result: makeResult(message.request.revision) });
		} else if (message?.type === 'syntax') {
			this.emit({ type: 'syntax', id: message.id, result: SYNTAX });
		}
		return message;
	}

	/** Fails the oldest unanswered message with a non-crash error (the worker stays usable). */
	failNext(error: EngineError = { kind: 'internal', message: 'bridge exception' }): ToWorker | undefined {
		const message = this.unanswered.shift();
		if (message?.type === 'schedule') {
			this.emit({ type: 'failed', revision: message.request.revision, error });
		} else if (message?.type === 'syntax') {
			this.emit({ type: 'failed', id: message.id, error });
		}
		return message;
	}

	/** Revisions of every schedule message posted to this worker. */
	postedRevisions(): Revision[] {
		return this.posted.flatMap((m) => (m.type === 'schedule' ? [m.request.revision] : []));
	}

	#dispatch(type: string, event: Event): void {
		for (const listener of this.#listeners.get(type) ?? []) (listener as (e: Event) => void)(event);
	}
}

/** A worker factory that records every worker it makes. */
export class FakeWorkerFactory {
	readonly workers: FakeWorker[] = [];
	/** When set, the next call throws it. */
	failNext: Error | null = null;

	readonly create = (): FakeWorker => {
		if (this.failNext) {
			const error = this.failNext;
			this.failNext = null;
			throw error;
		}
		const worker = new FakeWorker();
		this.workers.push(worker);
		return worker;
	};

	get current(): FakeWorker {
		const worker = this.workers.at(-1);
		if (!worker) throw new Error('FakeWorkerFactory: no worker created');
		return worker;
	}
}

/** Records how a promise settles, so a test can check it has not settled yet. */
export function observe<T>(promise: Promise<T>): { value: T | undefined; error: unknown } {
	const box: { value: T | undefined; error: unknown } = { value: undefined, error: undefined };
	promise.then(
		(value) => (box.value = value),
		(error: unknown) => (box.error = error),
	);
	return box;
}

/** Lets every pending promise callback run. Needs real `setImmediate` (fake only setTimeout). */
export function flush(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}
