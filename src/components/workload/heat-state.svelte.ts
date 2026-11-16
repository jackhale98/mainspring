// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The heatmap's state (phase-3.md 6.2, 8.3, 6.7, 18.3): the preferences of the open plan, and the
 * load model built from the newest good result.
 *
 * - **One idle task per result.** `offer` takes the newest result and the symbol index; the model
 *   is built in an idle task (`whenIdle`, after the Gantt's analysis), not in the task that handles
 *   the result. Until then the previous model stays. `availabilityOf` runs once per result and is
 *   kept by the result, so a zoom or a collapse (which rebuild the model at once: the user asked,
 *   and it costs at most 15 ms) reuse it. Each build is a `performance` measure,
 *   `mainspring:workload-load`, with the row and column counts (recorded, 8.3).
 * - **Dimming costs no rebuild.** `shown(dimmed)` re-wraps the model with `withDimmed`.
 * - **Demand.** `demand` is null until T10 (`demandOf`) merges: held and unmet work are zeros and
 *   no cell is over for them. When it does, it is made in its own idle task after the model and
 *   the model is rebuilt with it; this file is the seam.
 * - **One zone host** for the life of the view, the plain Intl one (`createTimeZoneHost`), not the
 *   Gantt's `memoZones`: the axis is kept per host (axis.ts).
 * - **Preferences** are per plan (heat-prefs.ts): the zoom, the unit, the thresholds and the
 *   collapsed groups, written as they change.
 */
import type { ScheduleResult } from '../../engine/protocol';
import { createTimeZoneHost } from '../../engine/timezone';
import { whenIdle } from '../../lib/gantt/analysis';
import { report } from '../../lib/report';
import { finishScenario } from '../../lib/schedule/finish';
import { browserStorage, type PrefStorage } from '../../lib/state/storage';
import type { SymbolIndex } from '../../lib/tjp/index';
import { availabilityOf } from '../../lib/workload/availability';
import {
	DEFAULT_HEAT_PREFS,
	readHeatPrefs,
	validThresholds,
	writeHeatPrefs,
	type HeatPrefs,
	type HeatUnit,
} from '../../lib/workload/heat-prefs';
import { buildLoad, withDimmed } from '../../lib/workload/load';
import type { Availability, BucketKind, LoadModel, Thresholds } from '../../lib/workload/types';

export const LOAD_MEASURE = 'mainspring:workload-load';

/** A model with what it was built from. */
export interface Built {
	readonly model: LoadModel;
	readonly availability: Availability;
	readonly result: ScheduleResult;
	readonly index: SymbolIndex;
}

const availabilities = new WeakMap<ScheduleResult, Map<string, Availability>>();

function availabilityFor(result: ScheduleResult, scenario: string): Availability {
	let byScenario = availabilities.get(result);
	if (!byScenario) availabilities.set(result, (byScenario = new Map()));
	let a = byScenario.get(scenario);
	if (!a) byScenario.set(scenario, (a = availabilityOf(result, scenario)));
	return a;
}

export class HeatState {
	prefs = $state.raw<HeatPrefs>(DEFAULT_HEAT_PREFS);
	built = $state.raw<Built | null>(null);
	/** The zone host of this view: one for its life (axis.ts keeps axes per host). */
	readonly zones = createTimeZoneHost();
	readonly #storage: PrefStorage | null;
	#plan = '';
	#cancel: (() => void) | null = null;
	#input: { result: ScheduleResult; index: SymbolIndex } | null = null;

	constructor(storage: PrefStorage | null = browserStorage()) {
		this.#storage = storage;
	}

	/** Switches to a plan's preferences (call when the open plan changes). */
	use(plan: string): void {
		this.#plan = plan;
		this.prefs = readHeatPrefs(this.#storage, plan);
		this.#rebuild();
	}

	/** The newest good result and the index. Builds in an idle task when either is new. */
	offer(result: ScheduleResult | null, index: SymbolIndex | null): void {
		const cur = this.#input;
		if (result === null || index === null) {
			this.#cancel?.();
			this.#cancel = null;
			this.#input = null;
			this.built = null;
			return;
		}
		if (cur && cur.result === result && cur.index === index) return;
		this.#input = { result, index };
		this.#cancel?.();
		this.#cancel = whenIdle(() => {
			this.#cancel = null;
			this.#rebuild();
		});
	}

	/** The model as drawn: dimmed while the newest outcome is not the result drawn. */
	shown(dimmed: boolean): LoadModel | null {
		const b = this.built;
		return b ? withDimmed(b.model, dimmed) : null;
	}

	setZoom(zoom: BucketKind): void {
		if (zoom === this.prefs.zoom) return;
		this.#save({ ...this.prefs, zoom });
		this.#rebuild();
	}

	setUnit(unit: HeatUnit): void {
		if (unit !== this.prefs.unit) this.#save({ ...this.prefs, unit });
	}

	/** Stores new thresholds; false (and nothing changes) when they are not valid. */
	setThresholds(thresholds: Thresholds): boolean {
		if (!validThresholds(thresholds)) return false;
		this.#save({ ...this.prefs, thresholds });
		return true;
	}

	/** Shows or hides a group's members. */
	toggleGroup(id: string): void {
		const has = this.prefs.collapsed.includes(id);
		const collapsed = has
			? this.prefs.collapsed.filter((c) => c !== id)
			: [...this.prefs.collapsed, id];
		this.#save({ ...this.prefs, collapsed });
		this.#rebuild();
	}

	dispose(): void {
		this.#cancel?.();
		this.#cancel = null;
	}

	#save(next: HeatPrefs): void {
		this.prefs = next;
		if (this.#plan !== '') writeHeatPrefs(this.#storage, this.#plan, next);
	}

	#rebuild(): void {
		const i = this.#input;
		if (!i) return;
		const scenario = finishScenario(i.result);
		if (scenario === null || !i.result.project) {
			this.built = null;
			return;
		}
		const t0 = performance.now();
		try {
			const availability = availabilityFor(i.result, scenario);
			const model = buildLoad({
				result: i.result,
				index: i.index,
				zones: this.zones,
				kind: this.prefs.zoom,
				collapsed: new Set(this.prefs.collapsed),
				availability,
				demand: null,
			});
			this.built = { model, availability, result: i.result, index: i.index };
			try {
				performance.measure(LOAD_MEASURE, {
					start: t0,
					end: performance.now(),
					detail: { rows: model.rows.length, columns: model.axis.count },
				});
			} catch {
				// A runtime without User Timing Level 3 still gets the model.
			}
		} catch (error) {
			report(error);
		}
	}
}
