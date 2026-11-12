// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Where the worker finds the engine assets: `<base>engine/` on the page's origin (ADR-0006). The
 * base is the site's base path, `import.meta.env.BASE_URL`: "/" by default and "/mainspring/" in
 * the GitHub Pages preview. Vite writes it into the worker bundle at build time, which also holds
 * under `astro dev`, where the worker is served from its source path rather than from `_astro/`.
 */

/** The engine directory URL for a site base path and the worker's own location. */
export function engineDirUrl(base: string, href: string): URL {
	const prefix = base.endsWith('/') ? base : `${base}/`;
	return new URL(`${prefix}engine/`, href);
}
