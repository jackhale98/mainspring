// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The view mode and the Split divider, remembered per sample (phase-2.md 9.1; ADR-0008 #3).
 * Text, Split and Visual are the modes; the layout supplies the default when nothing is stored
 * (Split on a desktop, Visual on a tablet, the Gantt tab on a phone: view-mode.ts). A link's
 * `?mode=` wins once, for the plan it opened with. Only UI preferences go to `localStorage`.
 */
import { browserStorage, readPref, writePref, type PrefStorage } from './storage';
import { DEFAULT_RATIOS, clampRatio, parseRatios, serializeRatios, type SplitAxis } from './split';
import { modeFromParam, type ViewMode } from './view-mode';

export const modeKey = (sample: string): string => `mainspring.mode.${sample}`;
export const splitKey = (sample: string): string => `mainspring.split.${sample}`;

export interface ModeOptions {
	storage?: PrefStorage | null;
	/** The mode a link asked for; it applies to the first sample opened, not to later ones. */
	linked?: ViewMode | null;
}

export class ModeState {
	/** The mode chosen for the open sample; null follows the layout's default. */
	choice = $state<ViewMode | null>(null);
	ratios = $state(DEFAULT_RATIOS);
	readonly #storage: PrefStorage | null;
	#linked: ViewMode | null;
	#sample = '';

	constructor(opts: ModeOptions = {}) {
		this.#storage = opts.storage === undefined ? browserStorage() : opts.storage;
		this.#linked = opts.linked ?? null;
	}

	/** Switches to a sample's preferences. Call when the open sample changes. */
	use(sample: string): void {
		this.#sample = sample;
		const linked = this.#linked;
		this.#linked = null;
		this.choice = linked ?? modeFromParam(readPref(this.#storage, modeKey(sample)));
		this.ratios = parseRatios(readPref(this.#storage, splitKey(sample)));
	}

	set(mode: ViewMode): void {
		this.choice = mode;
		if (this.#sample !== '') writePref(this.#storage, modeKey(this.#sample), mode);
	}

	setRatio(axis: SplitAxis, value: number): void {
		this.ratios = { ...this.ratios, [axis]: clampRatio(value) };
	}

	/** Remembers the ratios; called when a drag or a key press ends. */
	saveRatios(): void {
		if (this.#sample !== '')
			writePref(this.#storage, splitKey(this.#sample), serializeRatios(this.ratios));
	}
}
