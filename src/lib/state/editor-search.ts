// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The editor's find and replace, loaded when it is first used. `@codemirror/search` (the panel,
 * the query, the match highlighting) is about 6 KB gzip that the first paint of Text mode does not
 * need, so the keymap here has the same keys as its `searchKeymap` and fetches the package on the
 * first press: Mod-F opens the panel as it did, a moment later on that first use. The package adds
 * its own state and panel when a command first runs (`openSearchPanel` appends its extensions), so
 * nothing else changes. A first load does not fetch it; pressing Ctrl or Cmd alone in the editor
 * (the first half of the shortcut) starts the fetch, so the panel is usually there by the time F
 * is down and keys typed after the shortcut go into the panel, not the plan text.
 *
 * A failed fetch (offline before the chunk was ever cached: there is no service worker yet) opens
 * nothing; the next press tries again. When the service worker lands, this chunk belongs in its
 * precache list (BUILD_PLAN.md "Offline and caching").
 */
import { EditorView, type Command, type KeyBinding } from '@codemirror/view';

type SearchModule = typeof import('@codemirror/search');

let loaded: SearchModule | null = null;
let loading: Promise<SearchModule> | null = null;

/** Starts the fetch (the Ctrl or Cmd key alone); a failure is left for the next press to retry. */
export function warmSearch(): void {
	if (!loaded) load().catch(() => undefined);
}

/** Warms the package when Ctrl or Cmd goes down in the editor, before the rest of a shortcut. */
export const warmSearchOnModifier = EditorView.domEventHandlers({
	keydown: (e) => {
		if (e.key === 'Control' || e.key === 'Meta') warmSearch();
		return false;
	},
});

function load(): Promise<SearchModule> {
	loading ??= import('@codemirror/search').then(
		(m) => (loaded = m),
		(e: unknown) => {
			// A failed fetch (offline without the chunk cached) is tried again on the next press.
			loading = null;
			throw e;
		},
	);
	return loading;
}

/**
 * A command that runs `pick(search)` now when the package has loaded, else once it has, on the view
 * if it is still on the page. It reports the key as handled at once, as the package's commands do.
 */
function lazy(pick: (m: SearchModule) => Command): Command {
	return (view) => {
		if (loaded) return pick(loaded)(view);
		load().then(
			(m) => {
				if (view.dom.isConnected) pick(m)(view);
			},
			() => undefined,
		);
		return true;
	};
}

/**
 * Same keys, scopes and `preventDefault` as `searchKeymap` (@codemirror/search 6.7). Escape only
 * closes a panel, and a panel exists only once the package has loaded, so before that it is not
 * handled and falls through to whatever else is bound to it.
 */
export const lazySearchKeymap: readonly KeyBinding[] = [
	{ key: 'Mod-f', run: lazy((m) => m.openSearchPanel), scope: 'editor search-panel' },
	{
		key: 'F3',
		run: lazy((m) => m.findNext),
		shift: lazy((m) => m.findPrevious),
		scope: 'editor search-panel',
		preventDefault: true,
	},
	{
		key: 'Mod-g',
		run: lazy((m) => m.findNext),
		shift: lazy((m) => m.findPrevious),
		scope: 'editor search-panel',
		preventDefault: true,
	},
	{
		key: 'Escape',
		run: (view) => (loaded ? loaded.closeSearchPanel(view) : false),
		scope: 'editor search-panel',
	},
	{ key: 'Mod-Shift-l', run: lazy((m) => m.selectSelectionMatches) },
	{ key: 'Mod-Alt-g', run: lazy((m) => m.gotoLine) },
	{ key: 'Mod-d', run: lazy((m) => m.selectNextOccurrence), preventDefault: true },
];
