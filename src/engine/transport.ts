// SPDX-License-Identifier: GPL-2.0-or-later
/** The engine client's view of its worker: the transport shape, the default worker, and helpers. */
import type { FromWorker, ToWorker } from './protocol';

/** The part of `Worker` the client uses. A real `Worker` satisfies it. */
export interface WorkerLike {
	postMessage(message: ToWorker): void;
	terminate(): void;
	addEventListener(type: 'message', listener: (event: MessageEvent<FromWorker>) => void): void;
	addEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void;
}

/** Creates a fresh worker. Called once at start and again for every restart. */
export type WorkerFactory = () => WorkerLike;

export function createDefaultWorker(workerUrl: URL | undefined): WorkerLike {
	if (workerUrl) return new Worker(workerUrl, { type: 'module' });
	// Vite bundles the worker only when it sees this literal `new Worker(new URL(...))` form.
	// It runs only when no transport is injected, so tests and type checks never need worker.ts.
	return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
}

/**
 * Wires a worker's events. `onMessage` gets null for data that is not an object, so the caller
 * can still count it as a sign of life.
 */
export function listen(
	worker: WorkerLike,
	onMessage: (message: FromWorker | null) => void,
	onError: (event: Event) => void,
): void {
	worker.addEventListener('message', (event) => {
		const data: unknown = event.data;
		onMessage(typeof data === 'object' && data !== null ? event.data : null);
	});
	worker.addEventListener('error', onError);
	worker.addEventListener('messageerror', onError);
}

/** Posts a message; false if the worker is gone or refused it (e.g. DataCloneError). */
export function send(worker: WorkerLike | null, message: ToWorker): boolean {
	if (worker === null) return false;
	try {
		worker.postMessage(message);
		return true;
	} catch {
		return false;
	}
}

/** What went wrong in an `error` or `messageerror` event, for an EngineError message and detail. */
export function describeWorkerError(event: Event): { reason: string; detail?: string } {
	const text = 'message' in event && typeof event.message === 'string' ? event.message : '';
	const reason =
		event.type === 'messageerror'
			? 'sent a message that could not be read'
			: 'stopped unexpectedly';
	return text ? { reason, detail: text } : { reason };
}

/** EngineError `detail` for something thrown. */
export function describeThrown(error: unknown): { detail?: string } {
	if (error instanceof Error) return { detail: `${error.name}: ${error.message}` };
	return error === undefined ? {} : { detail: String(error) };
}
