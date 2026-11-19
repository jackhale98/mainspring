// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Which end-to-end test hooks a page asks for (`/app?hooks=edits,gantt`), and the way the app
 * installs one: the hook's module is fetched only when the parameter names it, so a normal load
 * carries none of their code (about 1 KB gzip for the Gantt and edit hooks).
 */

export const HOOKS_PARAM = 'hooks';

/** Whether `?hooks=` names `name`, alone or in a comma list. */
export function hookAsked(params: URLSearchParams, name: string): boolean {
	return (params.get(HOOKS_PARAM) ?? '')
		.split(',')
		.map((s) => s.trim())
		.includes(name);
}

/**
 * Installs the hook `name` when the page asks for it, from `load`, which fetches the hook's module
 * and installs it and gives back the uninstall. Returns an uninstall that is safe to call at any
 * time, also before the module has arrived (the hook is then removed as soon as it has).
 */
export function installHookLazily(
	params: URLSearchParams,
	name: string,
	load: () => Promise<() => void>,
): () => void {
	if (!hookAsked(params, name)) return () => undefined;
	let off: (() => void) | null = null;
	let gone = false;
	load().then(
		(uninstall) => {
			if (gone) uninstall();
			else off = uninstall;
		},
		() => undefined,
	);
	return () => {
		gone = true;
		off?.();
	};
}
