// SPDX-License-Identifier: GPL-2.0-or-later
/// <reference types="vite/client" />
/**
 * Links between the site's own pages. The site may be served under a base path ("/" by default,
 * "/mainspring/" in the GitHub Pages preview, ADR-0006), so a page never writes a root-absolute
 * URL such as "/app"; it writes `sitePath('app')`.
 */

/** `path` under the site's base path, joined with exactly one slash. */
export function sitePath(path: string, base: string = import.meta.env.BASE_URL): string {
	const prefix = base.endsWith('/') ? base : `${base}/`;
	return prefix + path.replace(/^\/+/, '');
}
