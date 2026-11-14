// SPDX-License-Identifier: GPL-2.0-or-later
// Astro integration for test-only pages. They are routed only when MAINSPRING_DEV_PAGES=1, so
// a normal build contains none of them. The page files start with "_" so that Astro's file
// routing ignores them; this integration injects them.

/** Routes of the dev pages: URL pattern and entrypoint. */
export const DEV_PAGES = [
	{ pattern: '/dev/engine', entrypoint: './src/pages/dev/_engine.astro' },
	{ pattern: '/dev/gantt-perf', entrypoint: './src/pages/dev/_gantt-perf.astro' },
];

/**
 * @param {{ MAINSPRING_DEV_PAGES?: string | undefined }} [env]
 * @returns {import('astro').AstroIntegration}
 */
export function devPages(env = process.env) {
	return {
		name: 'mainspring-dev-pages',
		hooks: {
			'astro:config:setup': ({ injectRoute }) => {
				if (env.MAINSPRING_DEV_PAGES !== '1') return;
				for (const page of DEV_PAGES) injectRoute(page);
			},
		},
	};
}
