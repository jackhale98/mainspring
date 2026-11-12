// SPDX-License-Identifier: GPL-2.0-or-later
// The site's base path (ADR-0006), read from MAINSPRING_BASE by astro.config.mjs. The default is
// "/", which dev, CI, the end-to-end tests and golden parity use. The GitHub Pages preview builds
// with MAINSPRING_BASE=/mainspring/. App code reads the result as import.meta.env.BASE_URL.

/** One path segment: letters, digits and the URL-safe marks `.`, `_`, `~` and `-`. */
const SEGMENT = /^[A-Za-z0-9._~-]+$/;

/**
 * The normalised base path, always with a leading and a trailing slash ("/", "/mainspring/").
 * An empty or unset value is "/". Throws on anything that is not a plain path, so a typo fails the
 * build instead of producing a site whose URLs point elsewhere.
 * @param {{ MAINSPRING_BASE?: string | undefined }} [env]
 * @returns {string}
 */
export function resolveBase(env = process.env) {
	const raw = (env.MAINSPRING_BASE ?? '').trim();
	if (raw === '' || raw === '/') return '/';
	const segments = raw.replace(/^\/|\/$/g, '').split('/');
	for (const segment of segments) {
		if (!SEGMENT.test(segment) || segment === '.' || segment === '..') {
			throw new Error(
				`MAINSPRING_BASE must be a plain path such as /mainspring/ (got ${JSON.stringify(raw)})`,
			);
		}
	}
	return `/${segments.join('/')}/`;
}
