// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// AppState and the keyword docs (ADR-0017): the app never asks the engine for them, and only an
// editor starts loading the docs asset.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineDocsLoader, EngineDocsState } from '../../engine/docs-asset';
import type { SyntaxDocs } from '../../engine/protocol';
import type { Sample } from '../workspace/samples';
import { FakeEngineClient, flush } from '../workspace/testing/fake-engine-client';
import { AppState } from './app.svelte';

const PLAN = ['project p "P" 2026-01-05 +1m', 'task a "Alpha" { effort 1d }', ''].join('\n');

function sample(id: string, files: Record<string, string>): Sample {
	return {
		id: id as Sample['id'],
		label: id,
		load: () => Promise.resolve({ entry: 'plan.tjp', files }),
	};
}

const A = sample('one', { 'plan.tjp': PLAN });
const B = sample('two', { 'plan.tjp': PLAN + 'task b "Beta" { effort 2d }\n' });

/** A loader that counts its loads; `onLoad` sees the app when one starts. */
function fakeLoader(onLoad: () => void = () => undefined) {
	const loader = {
		state: { status: 'idle' } as EngineDocsState,
		calls: 0,
		load(): Promise<SyntaxDocs | null> {
			loader.calls++;
			onLoad();
			return Promise.resolve(null);
		},
	};
	return loader satisfies EngineDocsLoader;
}

let app: AppState | null = null;
afterEach(() => {
	app?.dispose();
	app = null;
	vi.restoreAllMocks();
});

/** Delivers the newest request's result and waits for the status to show it. */
async function schedule(client: FakeEngineClient): Promise<void> {
	await vi.waitFor(() => expect(client.open.length).toBeGreaterThan(0));
	client.done(client.lastRequest.revision);
	await vi.waitFor(() => expect(app?.status?.kind).toBe('ok'));
}

/** Boot, the first schedule, a worker restart (booting, then idle again) and a plan switch. */
async function session(client: FakeEngineClient): Promise<void> {
	await flush();
	client.setState('idle');
	await schedule(client);
	client.setState('booting');
	client.setState('idle');
	await flush();
	expect(await app?.openSample('two')).toBe(true);
	await schedule(client);
}

describe('AppState and the keyword docs (ADR-0017)', () => {
	it('never calls syntax(): boot, the first schedule, a worker restart, a plan switch', async () => {
		const client = new FakeEngineClient();
		client.state = 'booting';
		const docs = fakeLoader();
		app = new AppState({ client, samples: [A, B], docs, keyTarget: null });
		await session(client);
		expect(client.syntaxCalls).toBe(0);
		await app.ensureEditor();
		client.setState('booting');
		client.setState('idle');
		await flush();
		expect(client.syntaxCalls).toBe(0);
	});

	it('starts the docs loader once, after the editor support is attached', async () => {
		const client = new FakeEngineClient();
		let readyAtLoad: boolean | null = null;
		const docs = fakeLoader(() => (readyAtLoad = app?.editorReady ?? null));
		app = new AppState({ client, samples: [A, B], docs, keyTarget: null });
		await flush();
		await Promise.all([app.ensureEditor(), app.ensureEditor()]);
		await app.ensureEditor();
		expect(app.editorReady).toBe(true);
		expect(docs.calls).toBe(1);
		expect(readyAtLoad).toBe(true);
		expect(await app.openSample('two')).toBe(true);
		await app.ensureEditor();
		expect(docs.calls).toBe(1);
	});

	it('never loads the docs in a Visual-only session', async () => {
		const client = new FakeEngineClient();
		client.state = 'booting';
		const docs = fakeLoader();
		app = new AppState({ client, samples: [A, B], docs, keyTarget: null });
		await session(client);
		expect(docs.calls).toBe(0);
	});

	it("with the editor bundle's own loader, fetches nothing until an editor needs the docs", async () => {
		const fetch = vi
			.spyOn(globalThis, 'fetch')
			.mockImplementation(() => Promise.resolve(new Response('{}', { status: 404 })));
		const client = new FakeEngineClient();
		client.state = 'booting';
		app = new AppState({ client, samples: [A, B], keyTarget: null });
		await session(client);
		expect(fetch).not.toHaveBeenCalled();
		await app.ensureEditor();
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
		expect(String(fetch.mock.calls[0]?.[0])).toBe(
			new URL('/engine/manifest.json', location.href).href,
		);
		expect(client.syntaxCalls).toBe(0);
	});
});
