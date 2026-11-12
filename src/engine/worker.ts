// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The engine Web Worker entry (phase-0 spec 3.2). It fetches `<base>engine/manifest.json` and the
 * hashed assets it names, boots TaskJuggler on ruby.wasm (runtime.ts) and answers the client's
 * messages one at a time (dispatch.ts). transport.ts starts it as a module worker. `<base>` is the
 * site's base path, "/" unless the build sets MAINSPRING_BASE (engine-url.ts, ADR-0006).
 *
 * manifest.json is revalidated on every boot; the hashed assets never change under their names,
 * so the HTTP cache may serve them.
 */
import { startDispatcher } from './dispatch.ts';
import { engineDirUrl } from './engine-url.ts';
import type { FromWorker } from './protocol';
import { bootEngine } from './runtime.ts';

/** The parts of DedicatedWorkerGlobalScope used here (the project's TS lib is DOM, not WebWorker). */
interface WorkerScope {
	readonly location: { readonly href: string };
	postMessage(message: FromWorker): void;
	addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}

const scope = self as unknown as WorkerScope;
const engineDir = engineDirUrl(import.meta.env.BASE_URL, scope.location.href);

async function fetchAsset(path: string): Promise<Uint8Array> {
	const response = await fetch(new URL(path, engineDir), {
		cache: path === 'manifest.json' ? 'no-cache' : 'default',
	});
	if (!response.ok) throw new Error(`HTTP ${response.status} for ${response.url}`);
	return new Uint8Array(await response.arrayBuffer());
}

const handle = startDispatcher(
	() =>
		bootEngine({
			load: fetchAsset,
			log: (stream, line) => console.debug(`[engine ${stream}] ${line}`),
		}),
	(message) => scope.postMessage(message),
);
scope.addEventListener('message', (event) => handle(event.data));
