// SPDX-License-Identifier: GPL-2.0-or-later
// This build's name (ADR-0012), injected by scripts/astro-build-id.mjs. Tests and the dev server
// see "dev".
import type { BuildInfo } from './update-check';

declare const __MAINSPRING_BUILD__: BuildInfo | undefined;

export const BUILD: BuildInfo =
	typeof __MAINSPRING_BUILD__ === 'undefined' ? { id: 'dev', builtAt: '' } : __MAINSPRING_BUILD__;

/** "3f2a91bc" and the build time for display; the id alone on a dev server. */
export function buildLabel(b: BuildInfo, locale?: string): string {
	const commit = b.id.split('-')[0] ?? b.id;
	if (!b.builtAt) return commit;
	const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
		new Date(b.builtAt),
	);
	return `${commit} · ${when}`;
}
