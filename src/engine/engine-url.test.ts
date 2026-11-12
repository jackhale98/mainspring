// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { engineDirUrl } from './engine-url.ts';

const WORKER = 'https://example.test/mainspring/_astro/worker.abc123.js';

describe('engineDirUrl', () => {
	it('puts the engine at /engine/ for the root base', () => {
		expect(engineDirUrl('/', 'http://localhost:4321/_astro/worker.abc123.js').href).toBe(
			'http://localhost:4321/engine/',
		);
	});

	it('puts the engine under a project base path', () => {
		expect(engineDirUrl('/mainspring/', WORKER).href).toBe('https://example.test/mainspring/engine/');
	});

	it('accepts a base without its trailing slash', () => {
		expect(engineDirUrl('/mainspring', WORKER).href).toBe('https://example.test/mainspring/engine/');
	});

	it('does not depend on where the worker script itself is served', () => {
		// `astro dev` serves the worker from its source path.
		const dev = 'http://localhost:4321/mainspring/src/engine/worker.ts?worker_file&type=module';
		expect(engineDirUrl('/mainspring/', dev).href).toBe('http://localhost:4321/mainspring/engine/');
	});

	it('resolves the asset names of the manifest inside the directory', () => {
		const dir = engineDirUrl('/mainspring/', WORKER);
		expect(new URL('manifest.json', dir).pathname).toBe('/mainspring/engine/manifest.json');
	});
});
