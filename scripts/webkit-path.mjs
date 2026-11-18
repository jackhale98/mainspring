// SPDX-License-Identifier: GPL-2.0-or-later
// Where Playwright's WebKit lives for local runs (ADR-0016 section 2): PLAYWRIGHT_BROWSERS_PATH
// when it is set, else a git-ignored folder in the repository. Shared by setup-webkit.mjs and
// test-e2e-iphone.mjs so that both look in the same place.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_WEBKIT_DIR = resolve(
	fileURLToPath(new URL('..', import.meta.url)),
	'.cache',
	'pw-webkit',
);

/**
 * The browsers folder for this run: the environment's choice, else the repository's own. `0` is
 * Playwright's own setting (the browsers live inside node_modules) and is passed on as it is.
 */
export function webkitBrowsersPath(env = process.env) {
	const set = env['PLAYWRIGHT_BROWSERS_PATH'];
	if (set === '0') return '0';
	return set ? resolve(set) : DEFAULT_WEBKIT_DIR;
}
