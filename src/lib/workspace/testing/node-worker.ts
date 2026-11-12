// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Test-only WorkerLike that runs an engine in the same Node process: the worker's own dispatcher
 * (src/engine/dispatch.ts) behind asynchronous, structured-cloned messages, as a Web Worker would
 * deliver them. With a booted `bootNodeEngine()` engine (engine/golden/run-wasm.mjs) the engine
 * client and everything above it run against the real TaskJuggler bundle. `terminate` stops
 * delivery; the engine itself stays usable for the next worker. Not imported by application code.
 */
import type { WorkerLike } from '../../../engine/client';
import { startDispatcher, type EngineLike } from '../../../engine/dispatch';
import type { FromWorker, ToWorker } from '../../../engine/protocol';

type MessageListener = (event: MessageEvent<FromWorker>) => void;

export class NodeWorker implements WorkerLike {
	readonly #listeners: MessageListener[] = [];
	readonly #handle: (message: unknown) => void;
	#terminated = false;

	constructor(engine: EngineLike) {
		this.#handle = startDispatcher(
			() => Promise.resolve(engine),
			(reply) => {
				const data = structuredClone(reply);
				setTimeout(() => {
					if (this.#terminated) return;
					for (const l of [...this.#listeners]) l(new MessageEvent('message', { data }));
				}, 0);
			},
		);
	}

	postMessage(message: ToWorker): void {
		if (this.#terminated) throw new Error('NodeWorker: postMessage after terminate');
		const data = structuredClone(message);
		setTimeout(() => {
			if (!this.#terminated) this.#handle(data);
		}, 0);
	}

	terminate(): void {
		this.#terminated = true;
	}

	addEventListener(type: 'message', listener: MessageListener): void;
	addEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void;
	addEventListener(type: string, listener: (event: never) => void): void {
		// The engine runs in-process, so it never raises worker error events.
		if (type === 'message') this.#listeners.push(listener as MessageListener);
	}
}
