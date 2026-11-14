// SPDX-License-Identifier: GPL-2.0-or-later
// The dev pages must not exist unless MAINSPRING_DEV_PAGES=1 (phase-0 spec 7.2).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEV_PAGES, devPages } from '../../scripts/astro-dev-pages.mjs';
import { REPO } from './corpus';

interface Route {
	pattern: string;
	entrypoint: string;
}

function injected(env: { MAINSPRING_DEV_PAGES?: string }): Route[] {
	const routes: Route[] = [];
	const hook = devPages(env).hooks['astro:config:setup'] as (options: unknown) => void;
	hook({ injectRoute: (route: Route) => routes.push(route) });
	return routes;
}

describe('devPages integration', () => {
	it('injects no route in a normal build', () => {
		expect(injected({})).toEqual([]);
		expect(injected({ MAINSPRING_DEV_PAGES: '' })).toEqual([]);
		expect(injected({ MAINSPRING_DEV_PAGES: '0' })).toEqual([]);
	});

	it('injects /dev/engine and /dev/gantt-perf when MAINSPRING_DEV_PAGES=1', () => {
		expect(injected({ MAINSPRING_DEV_PAGES: '1' }).map((r) => r.pattern)).toEqual([
			'/dev/engine',
			'/dev/gantt-perf',
		]);
	});

	it('keeps the page files out of file-based routing and on disk', () => {
		for (const page of DEV_PAGES) {
			expect(path.basename(page.entrypoint).startsWith('_')).toBe(true);
			expect(existsSync(path.join(REPO, page.entrypoint))).toBe(true);
		}
	});
});
