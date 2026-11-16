// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Which People view is on screen (phase-3.md 6.7, 18.10), remembered per plan (ADR-0008 #3,
 * workload/prefs.ts). `view` is the desktop and tablet view switcher (Gantt, Workload, Resources,
 * Calendar); `segment` is the phone People tab's segmented control (Load, Lanes, Calendar, Team).
 * They are two preferences: the phone's tab bar (`AppState.phoneTab`) and the desktop's mode
 * (Text, Split, Visual) decide whether either is shown at all.
 *
 * Like `ModeState`, it follows the open plan: call `use(plan)` when the plan changes. `?view=`
 * (a link or a test) wins once, for the plan the page opened with.
 */
import {
	DEFAULT_SEGMENT,
	DEFAULT_VIEW,
	parseView,
	readSegment,
	readView,
	writeSegment,
	writeView,
} from '../workload/prefs';
import type { PeopleSegment, View } from './selection.svelte';
import { browserStorage, type PrefStorage } from './storage';

export interface PeopleViewOptions {
	storage?: PrefStorage | null;
	/** The view a link asked for; it applies to the first plan opened, not to later ones. */
	linked?: string | null;
}

export class PeopleViewState {
	view = $state<View>(DEFAULT_VIEW);
	segment = $state<PeopleSegment>(DEFAULT_SEGMENT);
	readonly #storage: PrefStorage | null;
	#linked: View | null;
	#plan = '';

	constructor(opts: PeopleViewOptions = {}) {
		this.#storage = opts.storage === undefined ? browserStorage() : opts.storage;
		this.#linked = parseView(opts.linked ?? null);
	}

	/** Switches to a plan's preferences. Call when the open plan changes. */
	use(plan: string): void {
		this.#plan = plan;
		const linked = this.#linked;
		this.#linked = null;
		this.view = linked ?? readView(this.#storage, plan) ?? DEFAULT_VIEW;
		this.segment = readSegment(this.#storage, plan) ?? DEFAULT_SEGMENT;
	}

	setView(view: View): void {
		this.view = view;
		if (this.#plan !== '') writeView(this.#storage, this.#plan, view);
	}

	setSegment(segment: PeopleSegment): void {
		this.segment = segment;
		if (this.#plan !== '') writeSegment(this.#storage, this.#plan, segment);
	}
}
