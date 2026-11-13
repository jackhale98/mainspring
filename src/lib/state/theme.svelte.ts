// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The theme as runes (theme.ts): the preference, whether the system prefers dark, and the theme
 * that results. It writes `data-theme` and `data-theme-pref` on the root element, follows the
 * system while the preference is "system", and remembers the preference in `localStorage`.
 */
import { browserStorage, readPref, writePref, type PrefStorage } from './storage';
import { THEME_KEY, nextPref, parsePref, resolveTheme, type Theme, type ThemePref } from './theme';

export interface ThemeOptions {
	storage?: PrefStorage | null;
	win?: Pick<Window, 'matchMedia'>;
	root?: Pick<HTMLElement, 'setAttribute'>;
}

export class ThemeState {
	pref = $state<ThemePref>('system');
	systemDark = $state(false);
	readonly resolved = $derived<Theme>(resolveTheme(this.pref, this.systemDark));
	readonly #storage: PrefStorage | null;
	readonly #query: MediaQueryList;
	readonly #root: Pick<HTMLElement, 'setAttribute'>;
	readonly #onChange = (): void => {
		this.systemDark = this.#query.matches;
		this.#apply();
	};

	constructor(opts: ThemeOptions = {}) {
		this.#storage = opts.storage === undefined ? browserStorage() : opts.storage;
		this.#root = opts.root ?? document.documentElement;
		this.#query = (opts.win ?? window).matchMedia('(prefers-color-scheme: dark)');
		this.systemDark = this.#query.matches;
		this.pref = parsePref(readPref(this.#storage, THEME_KEY));
		this.#query.addEventListener('change', this.#onChange);
		this.#apply();
	}

	#apply(): void {
		this.#root.setAttribute('data-theme', this.resolved);
		this.#root.setAttribute('data-theme-pref', this.pref);
	}

	set(pref: ThemePref): void {
		this.pref = pref;
		writePref(this.#storage, THEME_KEY, pref);
		this.#apply();
	}

	/** Light, then dark, then the system's, then light again. */
	cycle(): void {
		this.set(nextPref(this.pref));
	}

	dispose(): void {
		this.#query.removeEventListener('change', this.#onChange);
	}
}
