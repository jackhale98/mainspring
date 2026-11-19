// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineDocsLoader, EngineDocsState } from '../../engine/docs-asset';
import type { SyntaxDocs } from '../../engine/protocol';
import { KEYWORDS, TJ_VERSION } from '../tjp/syntax/keywords';
import { docsSource, engineDocsLoader } from './editor-bundle';

const DOCS: SyntaxDocs = { tjVersion: TJ_VERSION, keywords: [] };

const withState = (state: EngineDocsState): EngineDocsLoader => ({
	state,
	load: () => Promise.resolve(null),
});

afterEach(() => vi.restoreAllMocks());

describe('docsSource', () => {
	it('gives the table alone, loading, while the docs are fetched', () => {
		expect(docsSource(withState({ status: 'idle' }))).toEqual({
			table: KEYWORDS,
			engine: null,
			loading: false,
		});
		expect(docsSource(withState({ status: 'loading' }))).toEqual({
			table: KEYWORDS,
			engine: null,
			loading: true,
		});
	});

	it('gives the docs once loaded, and the table alone when they are unavailable', () => {
		expect(docsSource(withState({ status: 'loaded', docs: DOCS }))).toEqual({
			table: KEYWORDS,
			engine: DOCS,
			loading: false,
		});
		expect(docsSource(withState({ status: 'unavailable' }))).toEqual({
			table: KEYWORDS,
			engine: null,
			loading: false,
		});
	});
});

describe('engineDocsLoader', () => {
	it("reads the manifest in the site's engine directory, and fetches nothing before load()", async () => {
		const fetch = vi
			.spyOn(globalThis, 'fetch')
			.mockImplementation(() => Promise.resolve(new Response('{}', { status: 200 })));
		const loader = engineDocsLoader();
		expect(fetch).not.toHaveBeenCalled();
		expect(await loader.load()).toBeNull();
		expect(fetch.mock.calls.map((c) => String(c[0]))).toEqual([
			new URL('/engine/manifest.json', location.href).href,
		]);
	});
});
