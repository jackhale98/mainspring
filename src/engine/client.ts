// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Engine client (phase-0 spec 3.3): owns the engine worker, drives the latest-wins queue in
 * queue.ts, restarts the worker after a crash or timeout, and turns worker replies into settled
 * promises. The worker itself (worker.ts, task T6) only ever sees one schedule at a time.
 *
 * Error `message` strings created here are diagnostics, not user-facing copy: views show
 * `EngineError.kind` through src/lib/strings.ts.
 */
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

export type { EngineState, ScheduleOutcome } from './queue';

/** The part of `Worker` the client uses. A real `Worker` satisfies it. */
export interface WorkerLike {
	postMessage(message: ToWorker): void;
	terminate(): void;
	addEventListener(type: 'message', listener: (event: MessageEvent<FromWorker>) => void): void;
	addEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void;
}

/** Creates a fresh worker. Called once at start and again for every restart. */
export type WorkerFactory = () => WorkerLike;

export interface EngineClient {
	readonly state: EngineState;
	/** Resolves once the current worker is ready; rejects with `EngineRequestError` if it cannot boot. */
	ready(): Promise<EngineVersions>;
	/** Never rejects, except with `RangeError` for a non-increasing revision. */
	schedule(request: ScheduleRequest): Promise<ScheduleOutcome>;
	/** Cached after the first success. Rejects with `EngineRequestError`. */
	syntax(): Promise<SyntaxDocs>;
	cancel(revision: Revision): void;
	/** Calls `listener` on every state change (not with the current state). Returns an unsubscribe. */
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
	 * `Infinity` turns the watchdog off. Booting is not timed.
	 */
	timeoutMs?: number;
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
/** setTimeout's largest delay; longer delays would fire at once. */
const MAX_TIMER_MS = 2_147_483_647;
const RESTART_KINDS: ReadonlySet<EngineError['kind']> = new Set(['boot', 'crash', 'timeout']);
const UNSENT_ERROR: EngineError = Object.freeze({
	kind: 'invalid-request',
	message: 'The request could not be sent to the engine worker.',
});

interface Settlers<T> {
	resolve: (value: T) => void;
	reject: (reason: EngineRequestError) => void;
}

function createDefaultWorker(workerUrl: URL | undefined): WorkerLike {
	if (workerUrl) return new Worker(workerUrl, { type: 'module' });
	// Vite bundles the worker only when it sees this literal `new Worker(new URL(...))` form.
	// It runs only when no transport is injected, so tests and type checks never need worker.ts.
	return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
}

class Client implements EngineClient {
	readonly #queue = new ScheduleQueue();
	readonly #timeoutMs: number;
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
	#watchdog: ReturnType<typeof setTimeout> | null = null;
	readonly #listeners = new Set<(s: EngineState) => void>();
	#lastState: EngineState;

	constructor(opts: EngineClientOptions) {
		const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		if (!(timeoutMs > 0)) throw new RangeError(`timeoutMs must be positive, got ${timeoutMs}.`);
		this.#timeoutMs = timeoutMs;
		this.#lastState = this.#queue.state;
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
		this.#listeners.add(listener);
		return () => void this.#listeners.delete(listener);
	}

	dispose(): void {
		if (this.#failure === DISPOSED_ERROR) return;
		this.#failure = DISPOSED_ERROR;
		this.#listeners.clear();
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
			this.#halt({ kind: 'boot', message: 'The engine worker could not be created.', ...detail(error) });
			return;
		}
		this.#worker = worker;
		const generation = this.#generation;
		worker.addEventListener('message', (event) => {
			const data: unknown = event.data;
			if (generation !== this.#generation || typeof data !== 'object' || data === null) return;
			this.#onMessage(event.data);
		});
		const onError = (event: Event): void => {
			if (generation === this.#generation) this.#onWorkerError(event);
		};
		worker.addEventListener('error', onError);
		worker.addEventListener('messageerror', onError);
	}

	/** Unknown message types are ignored, so a newer worker cannot break an older client. */
	#onMessage(message: FromWorker): void {
		switch (message.type) {
			case 'ready':
				this.#versions = message.versions;
				this.#run(this.#queue.ready(), true);
				this.#settleReadyWaiters(message.versions);
				break;
			case 'scheduled':
				this.#run(this.#queue.result(message.result), true);
				break;
			case 'syntax':
				this.#run(this.#queue.syntaxResult(message.id, message.result), true);
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
			this.#run(this.#queue.failed(message.revision, error), true);
		} else if (message.id !== undefined) {
			this.#run(this.#queue.syntaxFailed(message.id, error), true);
		} else {
			// A failure tied to no request leaves the worker in an unknown state.
			this.#restart(error);
		}
	}

	#onWorkerError(event: Event): void {
		const text = 'message' in event && typeof event.message === 'string' ? event.message : '';
		const messageerror = event.type === 'messageerror';
		const reason = messageerror ? 'sent a message that could not be read' : 'stopped unexpectedly';
		const extra = text ? { detail: text } : {};
		if (this.#queue.phase === 'booting') {
			this.#halt({ kind: 'boot', message: `The engine worker ${reason} while starting.`, ...extra });
		} else {
			this.#restart({ kind: 'crash', message: `The engine worker ${reason}.`, ...extra });
		}
	}

	#onTimeout(): void {
		this.#watchdog = null;
		this.#restart({
			kind: 'timeout',
			message: `The engine worker did not reply within ${this.#timeoutMs} ms.`,
		});
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
		this.#clearWatchdog();
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
					if (!this.#post(effect.message)) unsent.push(effect.message);
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

	#post(message: ToWorker): boolean {
		try {
			this.#worker?.postMessage(message);
			return true;
		} catch {
			return false;
		}
	}

	/** Keeps the watchdog running exactly while the worker owes a reply; reports state changes. */
	#afterEvent(progress: boolean): void {
		if (!this.#queue.hasOutstandingWork) {
			this.#clearWatchdog();
		} else if ((progress || this.#watchdog === null) && this.#timeoutMs <= MAX_TIMER_MS) {
			this.#clearWatchdog();
			this.#watchdog = setTimeout(() => this.#onTimeout(), this.#timeoutMs);
		}
		const state = this.#queue.state;
		if (state === this.#lastState) return;
		this.#lastState = state;
		for (const listener of [...this.#listeners]) {
			try {
				listener(state);
			} catch (error) {
				// A broken listener must not break the engine; report it without blocking.
				queueMicrotask(() => {
					throw error;
				});
			}
		}
	}

	#clearWatchdog(): void {
		if (this.#watchdog !== null) clearTimeout(this.#watchdog);
		this.#watchdog = null;
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

function detail(error: unknown): { detail?: string } {
	if (error instanceof Error) return { detail: `${error.name}: ${error.message}` };
	return error === undefined ? {} : { detail: String(error) };
}
