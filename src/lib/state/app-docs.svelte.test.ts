// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// AppState and the keyword docs (ADR-0017): the app never asks the engine for them, and only an
// editor starts loading the docs asset.
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineDocsLoader, EngineDocsState } from '../../engine/docs-asset';
import type { SyntaxDocs } from '../../engine/protocol';
import { editorStrings } from '../strings';
import { DOCS_WAIT_MS } from '../tjp/cm/docs-wait';
import { engineDocs } from '../tjp/cm/testing';
import { SUMMARIES } from '../tjp/syntax/summaries.generated';
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
	// The last plan is a preference (phase-4.md 18.7): each test starts on the first sample.
	localStorage.clear();
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

/** A loader whose load the test ends (`finish`), and whose state the test may set. */
function heldLoader() {
	let release: (docs: SyntaxDocs | null) => void = () => undefined;
	let running: Promise<SyntaxDocs | null> | null = null;
	const loader = {
		state: { status: 'idle' } as EngineDocsState,
		load(): Promise<SyntaxDocs | null> {
			if (loader.state.status === 'loaded') return Promise.resolve(loader.state.docs);
			if (!running) {
				loader.state = { status: 'loading' };
				running = new Promise((resolve) => (release = resolve));
			}
			return running;
		},
		finish(docs: SyntaxDocs | null): void {
			loader.state = docs
				? { status: 'loaded', docs }
				: { status: 'unavailable', retryAt: Date.now() + 5_000 };
			release(docs);
		},
	};
	return loader satisfies EngineDocsLoader;
}

describe('AppState.openDocs and the keyword docs (ADR-0017)', () => {
	let view: EditorView | null = null;
	afterEach(() => {
		vi.useRealTimers();
		view?.destroy();
		view = null;
	});

	/** An app with an editor on plan.tjp, the cursor in `word`; then fake timeouts. */
	async function withEditor(loader: ReturnType<typeof heldLoader>): Promise<AppState> {
		const client = new FakeEngineClient();
		const a = new AppState({ client, samples: [A, B], docs: loader, keyTarget: null });
		app = a;
		await a.ensureEditor();
		await vi.waitFor(() => expect(a.workspace).not.toBeNull());
		const ws = a.workspace;
		if (!ws) throw new Error('expected a workspace');
		view = new EditorView({ state: ws.state('plan.tjp') });
		a.editor = view;
		moveTo('effort');
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
		return a;
	}
	const moveTo = (word: string): void => {
		view?.dispatch({ selection: { anchor: PLAN.indexOf(word) + 1 } });
	};

	it('waits for docs that come within the bound and shows the full doc', async () => {
		const loader = heldLoader();
		const a = await withEditor(loader);
		const opening = a.openDocs();
		await vi.advanceTimersByTimeAsync(DOCS_WAIT_MS - 100);
		expect(a.docsOpen).toBe(false);
		loader.finish(engineDocs());
		await opening;
		expect(a.docsOpen).toBe(true);
		expect(a.docsContent?.title).toBe('effort');
		expect(a.docsContent?.body).toBe('Full documentation of effort.');
		expect(a.docsContent?.notes).not.toContain(editorStrings.hover.docsLoading);
	});

	it('past the bound shows the summary with the loading note', async () => {
		const a = await withEditor(heldLoader());
		const opening = a.openDocs();
		await vi.advanceTimersByTimeAsync(DOCS_WAIT_MS - 1);
		expect(a.docsOpen).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await opening;
		expect(a.docsOpen).toBe(true);
		expect(a.docsContent?.body).toBe(SUMMARIES['effort']);
		expect(a.docsContent?.notes.at(-1)).toBe(editorStrings.hover.docsLoading);
	});

	it('of two quick calls, only the later one shows, even when the earlier one ends last', async () => {
		const loader = heldLoader();
		const a = await withEditor(loader);
		const first = a.openDocs(); // waits: the docs are loading
		// The docs are in for the second call (its load not yet settled for the first): no wait.
		loader.state = { status: 'loaded', docs: engineDocs() };
		moveTo('task');
		await a.openDocs();
		expect(a.docsContent?.title).toBe('task');
		await vi.advanceTimersByTimeAsync(DOCS_WAIT_MS);
		await first;
		expect(a.docsContent?.title).toBe('task');
	});

	it('does not open the sheet when the editor went away during the wait', async () => {
		const loader = heldLoader();
		const a = await withEditor(loader);
		const opening = a.openDocs();
		a.editor = null; // Visual mode, or another plan
		loader.finish(engineDocs());
		await opening;
		expect(a.docsOpen).toBe(false);
		expect(a.docsContent).toBeNull();
	});
});
