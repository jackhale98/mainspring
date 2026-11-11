// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Engine client (phase-0 spec 3.3): owns the engine worker, drives the latest-wins queue in
 * queue.ts, restarts the worker after a crash or reply timeout, gives up when a boot stalls, and
 * turns worker replies into settled promises. The worker itself (worker.ts, task T6) only ever
 * sees one schedule at a time. Timers live in deadline.ts, listeners in notifier.ts, and the
 * worker plumbing in transport.ts.
 *
 * Error `message` strings created here are diagnostics, not user-facing copy: views show
 * `EngineError.kind` through src/lib/strings.ts.
 */
import { Deadline, checkDuration } from './deadline';
import { StateNotifier } from './notifier';
import type {
	EngineError,
	EngineVersions,
	FromWorker,
	Revision,
	ScheduleRequest,
	SyntaxDocs,
	ToWorker,
} from './protocol';
import {
	DISPOSED_ERROR,
	ScheduleQueue,
	type EngineState,
	type QueueEffect,
	type ScheduleOutcome,
} from './queue';
import {
	createDefaultWorker,
	describeThrown,
	describeWorkerError,
	listen,
	send,
	type WorkerFactory,
	type WorkerLike,
} from './transport';

export type { EngineState, ScheduleOutcome } from './queue';
export type { WorkerFactory, WorkerLike } from './transport';

export interface EngineClient {
	readonly state: EngineState;
	/** Resolves once the current worker is ready; rejects with `EngineRequestError` if it cannot boot. */
	ready(): Promise<EngineVersions>;
	/** Never rejects, except with `RangeError` for a non-increasing revision. */
	schedule(request: ScheduleRequest): Promise<ScheduleOutcome>;
	/** Cached after the first success. Rejects with `EngineRequestError`. */
	syntax(): Promise<SyntaxDocs>;
	cancel(revision: Revision): void;
	/**
	 * Calls `listener` on state changes (not with the current state), always with the state current
	 * at the call; changes made by listeners are coalesced. Returns an unsubscribe.
	 */
	onState(listener: (s: EngineState) => void): () => void;
	/** Terminates the worker. Open schedules settle `cancelled`; open syntax and ready calls reject. */
	dispose(): void;
}

export interface EngineClientOptions {
	/** Default: the bundled worker entry (`./worker.ts`). Ignored when `transport` is given. */
	workerUrl?: URL;
	/**
	 * Default 60_000. When the worker owes a reply and sends nothing for this long, the client
	 * terminates it, reboots, and settles the in-flight request `failed` with kind `timeout`.
	 * Any message from the live worker counts as progress and restarts the countdown.
	 * `Infinity` turns the watchdog off.
	 */
	timeoutMs?: number;
	/**
	 * Default 180_000. The first boot and every reboot must reach `ready` within this time, or the
	 * client terminates the worker and goes to `failed` with kind `boot`. `Infinity` turns it off.
	 */
	bootTimeoutMs?: number;
	/**
	 * Injectable for unit tests. A factory lets the client restart the worker after a crash or
	 * timeout; a single instance cannot be restarted, so a crash or timeout leaves it `failed`.
	 */
	transport?: WorkerLike | WorkerFactory;
}

/** Rejection reason of `ready()` and `syntax()`. */
export class EngineRequestError extends Error {
	readonly error: EngineError;

	constructor(error: EngineError) {
		super(error.message);
		this.name = 'EngineRequestError';
		this.error = error;
	}
}

export function createEngineClient(opts: EngineClientOptions = {}): EngineClient {
	return new Client(opts);
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_BOOT_TIMEOUT_MS = 180_000;
const RESTART_KINDS: ReadonlySet<EngineError['kind']> = new Set(['boot', 'crash', 'timeout']);
const UNSENT_ERROR: EngineError = Object.freeze({
	kind: 'invalid-request',
	message: 'The request could not be sent to the engine worker.',
});

interface Settlers<T> {
	resolve: (value: T) => void;
	reject: (reason: EngineRequestError) => void;
}

class Client implements EngineClient {
	readonly #queue = new ScheduleQueue();
	readonly #factory: WorkerFactory | null;
	#worker: WorkerLike | null = null;
	/** Bumped whenever a worker is dropped, so its late events are ignored. */
	#generation = 0;
	#versions: EngineVersions | null = null;
	#failure: EngineError | null = null;
	#readyWaiters: Array<Settlers<EngineVersions>> = [];
	readonly #schedules = new Map<Revision, (outcome: ScheduleOutcome) => void>();
	readonly #syntaxCalls = new Map<number, Settlers<SyntaxDocs>>();
	#nextSyntaxId = 1;
	#syntaxCache: SyntaxDocs | null = null;
	#syntaxPromise: Promise<SyntaxDocs> | null = null;
	/** Runs while the worker owes a reply (rule 6 timeout). */
	readonly #watchdog: Deadline;
	/** Runs from creating a worker until its `ready`. */
	readonly #bootDeadline: Deadline;
	readonly #notifier = new StateNotifier(() => this.#queue.state);

	constructor(opts: EngineClientOptions) {
		const timeoutMs = checkDuration('timeoutMs', opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
		const bootMs = checkDuration('bootTimeoutMs', opts.bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS);
		this.#watchdog = new Deadline(timeoutMs, () => this.#onTimeout());
		this.#bootDeadline = new Deadline(bootMs, () => this.#onBootTimeout());
		const { transport, workerUrl } = opts;
		if (typeof transport === 'object') {
			this.#factory = null;
			this.#start(() => transport);
		} else {
			const factory = transport ?? (() => createDefaultWorker(workerUrl));
			this.#factory = factory;
			this.#start(factory);
		}
	}

	get state(): EngineState {
		return this.#queue.state;
	}

	ready(): Promise<EngineVersions> {
		if (this.#failure) return Promise.reject(new EngineRequestError(this.#failure));
		if (this.#versions && this.#queue.state !== 'booting') return Promise.resolve(this.#versions);
		return new Promise((resolve, reject) => this.#readyWaiters.push({ resolve, reject }));
	}

	schedule(request: ScheduleRequest): Promise<ScheduleOutcome> {
		let effects: QueueEffect[];
		try {
			effects = this.#queue.request(request);
		} catch (error) {
			return Promise.reject(error);
		}
		const outcome = new Promise<ScheduleOutcome>((resolve) => {
			this.#schedules.set(request.revision, resolve);
		});
		this.#run(effects, false);
		return outcome;
	}

	syntax(): Promise<SyntaxDocs> {
		if (this.#syntaxCache) return Promise.resolve(this.#syntaxCache);
		if (this.#syntaxPromise) return this.#syntaxPromise;
		const id = this.#nextSyntaxId++;
		const docs = new Promise<SyntaxDocs>((resolve, reject) => {
			this.#syntaxCalls.set(id, { resolve, reject });
		});
		this.#syntaxPromise = docs;
		this.#run(this.#queue.syntax(id), false);
		return docs;
	}

	cancel(revision: Revision): void {
		this.#run(this.#queue.cancel(revision), false);
	}

	onState(listener: (s: EngineState) => void): () => void {
		return this.#notifier.subscribe(listener);
	}

	dispose(): void {
		if (this.#failure === DISPOSED_ERROR) return;
		this.#failure = DISPOSED_ERROR;
		this.#notifier.clear();
		this.#dropWorker();
		this.#apply(this.#queue.dispose());
		this.#settleReadyWaiters(DISPOSED_ERROR);
	}

	/** Creates and wires a worker; a factory that throws is a boot failure. */
	#start(factory: WorkerFactory): void {
		let worker: WorkerLike;
		try {
			worker = factory();
		} catch (error) {
			const message = 'The engine worker could not be created.';
			this.#halt({ kind: 'boot', message, ...describeThrown(error) });
			return;
		}
		this.#worker = worker;
		const generation = this.#generation;
		const live = (): boolean => generation === this.#generation;
		const onMessage = (message: FromWorker | null): void => {
			if (!live()) return;
			if (message) this.#onMessage(message);
			// Any message from the live worker is progress, even one this client cannot read.
			if (live()) this.#afterEvent(true);
		};
		listen(worker, onMessage, (event) => {
			if (live()) this.#onWorkerError(event);
		});
		this.#bootDeadline.start();
	}

	/**
	 * Applies one worker message; the listener then calls `#afterEvent`. Unknown message types are
	 * ignored, so a newer worker cannot break an older client.
	 */
	#onMessage(message: FromWorker): void {
		switch (message.type) {
			case 'ready':
				this.#bootDeadline.stop();
				this.#versions = message.versions;
				this.#apply(this.#queue.ready());
				this.#settleReadyWaiters(message.versions);
				break;
			case 'scheduled':
				this.#apply(this.#queue.result(message.result));
				break;
			case 'syntax':
				this.#apply(this.#queue.syntaxResult(message.id, message.result));
				break;
			case 'failed':
				this.#onFailed(message);
				break;
		}
	}

	#onFailed(message: Extract<FromWorker, { type: 'failed' }>): void {
		const error = message.error;
		if (this.#queue.phase === 'booting') {
			this.#halt(error);
		} else if (RESTART_KINDS.has(error.kind)) {
			this.#restart(error);
		} else if (message.revision !== undefined) {
			this.#apply(this.#queue.failed(message.revision, error));
		} else if (message.id !== undefined) {
			this.#apply(this.#queue.syntaxFailed(message.id, error));
		} else {
			// A failure tied to no request leaves the worker in an unknown state.
			this.#restart(error);
		}
	}

	#onWorkerError(event: Event): void {
		const { reason, ...extra } = describeWorkerError(event);
		if (this.#queue.phase === 'booting') {
			this.#halt({ kind: 'boot', message: `The engine worker ${reason} while starting.`, ...extra });
		} else {
			this.#restart({ kind: 'crash', message: `The engine worker ${reason}.`, ...extra });
		}
	}

	#onTimeout(): void {
		const message = `The engine worker did not reply within ${this.#watchdog.ms} ms.`;
		this.#restart({ kind: 'timeout', message });
	}

	#onBootTimeout(): void {
		const message = `The engine worker did not start within ${this.#bootDeadline.ms} ms.`;
		this.#halt({ kind: 'boot', message });
	}

	/** Rule 6: fail what the worker owed, terminate it, and boot a new one. */
	#restart(error: EngineError): void {
		this.#dropWorker();
		this.#apply(this.#queue.crashed(error));
		if (this.#factory === null) {
			this.#halt(error);
			return;
		}
		this.#start(this.#factory);
		this.#afterEvent(false);
	}

	/** Final failure: the worker cannot boot or cannot be restarted. */
	#halt(error: EngineError): void {
		this.#failure ??= error;
		this.#dropWorker();
		this.#apply(this.#queue.halt(error));
		this.#settleReadyWaiters(error);
		this.#afterEvent(false);
	}

	#dropWorker(): void {
		this.#generation++;
		this.#watchdog.stop();
		this.#bootDeadline.stop();
		const worker = this.#worker;
		this.#worker = null;
		worker?.terminate();
	}

	#run(effects: QueueEffect[], progress: boolean): void {
		this.#apply(effects);
		this.#afterEvent(progress);
	}

	#apply(effects: QueueEffect[]): void {
		const unsent: ToWorker[] = [];
		for (const effect of effects) {
			switch (effect.type) {
				case 'post':
					if (!send(this.#worker, effect.message)) unsent.push(effect.message);
					break;
				case 'settle': {
					const resolve = this.#schedules.get(effect.revision);
					this.#schedules.delete(effect.revision);
					resolve?.(effect.outcome);
					break;
				}
				case 'syntax-settle': {
					const call = this.#syntaxCalls.get(effect.id);
					this.#syntaxCalls.delete(effect.id);
					this.#syntaxPromise = null;
					if (effect.outcome.ok) {
						this.#syntaxCache = effect.outcome.result;
						call?.resolve(effect.outcome.result);
					} else {
						call?.reject(new EngineRequestError(effect.outcome.error));
					}
					break;
				}
			}
		}
		// A message the worker could not take (e.g. DataCloneError) fails its own request only.
		// Handled after the loop so effects are never applied out of order.
		for (const message of unsent) {
			if (message.type === 'schedule') {
				this.#apply(this.#queue.failed(message.request.revision, UNSENT_ERROR));
			} else if (message.type === 'syntax') {
				this.#apply(this.#queue.syntaxFailed(message.id, UNSENT_ERROR));
			}
		}
	}

	/** Keeps the watchdog running exactly while the worker owes a reply; reports state changes. */
	#afterEvent(progress: boolean): void {
		if (!this.#queue.hasOutstandingWork) this.#watchdog.stop();
		else if (progress || !this.#watchdog.armed) this.#watchdog.start();
		this.#notifier.notify();
	}

	#settleReadyWaiters(outcome: EngineVersions | EngineError): void {
		const waiters = this.#readyWaiters;
		this.#readyWaiters = [];
		for (const { resolve, reject } of waiters) {
			if ('kind' in outcome) reject(new EngineRequestError(outcome));
			else resolve(outcome);
		}
	}
}
