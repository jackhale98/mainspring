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
 * - **Demand** (T10's `demandOf`, held and unmet work, 6.3) is made in its own idle task after the
 *   model is built, once per result and index (cached by the result object; its first call in a
 *   fresh worker is 8 to 21 ms on fedora-res and cannot be chunked), and the model is then built
 *   again with the marks: held and unmet work show in the cells and the details, and cells go over
 *   with the reason. Until then the model has none (zeros). A demand that throws is cached as none
 *   and reported; the hours do not depend on it.
 * - **One zone host** for the life of the view, the plain Intl one (`createTimeZoneHost`), not the
 *   Gantt's `memoZones`: the axis is kept per host (axis.ts).
 * - **Preferences** are per plan (heat-prefs.ts): the zoom, the unit, the thresholds and the
 *   collapsed groups, written as they change.
 * - **The lanes** (T15, components/resources) use a second instance of this class: the thresholds,
 *   the unit and the collapsed groups are the heatmap's (one rule for "over", one set of open
 *   groups), but the zoom is the lanes' own, kept under `zoomKey` so that the two views zoom
 *   apart. `refresh` re-reads what the other view wrote, when this view is shown again.
 */
import type { ScheduleResult } from '../../engine/protocol';
import { createTimeZoneHost } from '../../engine/timezone';
import { analysisOf, whenIdle } from '../../lib/gantt/analysis';
import { demandOf } from '../../lib/schedule/demand';
import type { DemandMarks } from '../../lib/schedule/explain-types';
import { workingTimeOf } from '../../lib/schedule/working-time';
import { report } from '../../lib/report';
import { finishScenario } from '../../lib/schedule/finish';
import { browserStorage, readPref, writePref, type PrefStorage } from '../../lib/state/storage';
import type { SymbolIndex } from '../../lib/tjp/index';
import { availabilityOf } from '../../lib/workload/availability';
import {
	DEFAULT_HEAT_PREFS,
	DEFAULT_HEAT_ZOOM,
	ZOOMS,
	readHeatPrefs,
	validThresholds,
	writeHeatPrefs,
	type HeatPrefs,
	type HeatUnit,
} from '../../lib/workload/heat-prefs';
import { buildLoad, withDimmed } from '../../lib/workload/load';
import type { Availability, BucketKind, LoadModel, Thresholds } from '../../lib/workload/types';

export const LOAD_MEASURE = 'mainspring:workload-load';
export const DEMAND_MEASURE = 'mainspring:workload-demand';

/** A model with what it was built from. */
export interface Built {
	readonly model: LoadModel;
	readonly availability: Availability;
	readonly result: ScheduleResult;
	readonly index: SymbolIndex;
}

const availabilities = new WeakMap<ScheduleResult, Map<string, Availability>>();
/** The marks of a result, for the index they were read with (the text can narrow what books). */
const demands = new WeakMap<ScheduleResult, { index: SymbolIndex; marks: DemandMarks | null }>();

function availabilityFor(result: ScheduleResult, scenario: string): Availability {
	let byScenario = availabilities.get(result);
	if (!byScenario) availabilities.set(result, (byScenario = new Map()));
	let a = byScenario.get(scenario);
	if (!a) byScenario.set(scenario, (a = availabilityOf(result, scenario)));
	return a;
}

export interface HeatStateOptions {
	/** Where this view keeps its own zoom, per plan; without it the zoom is in the heatmap's prefs. */
	readonly zoomKey?: (plan: string) => string;
}

export class HeatState {
	prefs = $state.raw<HeatPrefs>(DEFAULT_HEAT_PREFS);
	built = $state.raw<Built | null>(null);
	/** The zone host of this view: one for its life (axis.ts keeps axes per host). */
	readonly zones = createTimeZoneHost();
	readonly #storage: PrefStorage | null;
	#plan = '';
	#cancel: (() => void) | null = null;
	#cancelDemand: (() => void) | null = null;
	#input: { result: ScheduleResult; index: SymbolIndex } | null = null;

	readonly #zoomKey: ((plan: string) => string) | null;

	constructor(storage: PrefStorage | null = browserStorage(), opts: HeatStateOptions = {}) {
		this.#storage = storage;
		this.#zoomKey = opts.zoomKey ?? null;
	}

	#read(plan: string): HeatPrefs {
		const prefs = readHeatPrefs(this.#storage, plan);
		if (!this.#zoomKey) return prefs;
		const kept = readPref(this.#storage, this.#zoomKey(plan));
		return { ...prefs, zoom: ZOOMS.find((z) => z === kept) ?? DEFAULT_HEAT_ZOOM };
	}

	/** Switches to a plan's preferences (call when the open plan changes). */
	use(plan: string): void {
		if (plan === this.#plan) return;
		this.#plan = plan;
		this.prefs = this.#read(plan);
		// The plan id changes while the previous plan's result is still the runner's (the new one
		// loads first): never build that result with the new plan's preferences. The new plan's
		// result is a new object and is offered when it arrives; until then there is nothing drawn.
		this.#cancel?.();
		this.#cancelDemand?.();
		this.#cancel = this.#cancelDemand = null;
		this.#input = null;
		this.built = null;
	}

	/** The newest good result and the index. Builds in an idle task (8.3) when either is new. */
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
		this.#cancelDemand?.();
		this.#cancelDemand = null;
		this.#cancel = whenIdle(() => {
			this.#cancel = null;
			this.#rebuild();
		});
	}

	/**
	 * Takes up what another view wrote to the shared preferences (thresholds, unit, collapsed
	 * groups): call when this view is shown again. Rebuilds only when the open groups changed.
	 */
	refresh(): void {
		if (this.#plan === '') return;
		const next = this.#read(this.#plan);
		const was = this.prefs;
		const same = (a: readonly string[], b: readonly string[]): boolean =>
			a.length === b.length && a.every((x, i) => x === b[i]);
		if (
			next.unit === was.unit &&
			next.zoom === was.zoom &&
			next.thresholds.spareBelow === was.thresholds.spareBelow &&
			next.thresholds.overAbove === was.thresholds.overAbove &&
			same(next.collapsed, was.collapsed)
		) {
			return;
		}
		this.prefs = next;
		if (!same(next.collapsed, was.collapsed) || next.zoom !== was.zoom) this.#rebuild();
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
		this.#cancelDemand?.();
		this.#cancel = this.#cancelDemand = null;
	}

	/** Held and unmet work of the input, once per result and index; schedules it when missing. */
	#demandFor(i: { result: ScheduleResult; index: SymbolIndex }): DemandMarks | null {
		const known = demands.get(i.result);
		if (known && known.index === i.index) return known.marks;
		if (this.#cancelDemand === null) {
			this.#cancelDemand = whenIdle(() => {
				this.#cancelDemand = null;
				if (this.#input?.result !== i.result || this.#input.index !== i.index) return;
				// The other view of the same result (the lanes and the heatmap each have a state) may have
				// made them meanwhile: they are made once per result and index.
				const made = demands.get(i.result);
				if (!made || made.index !== i.index) {
					demands.set(i.result, { index: i.index, marks: this.#marksOf(i.result, i.index) });
				}
				this.#rebuild();
			});
		}
		return null;
	}

	#marksOf(result: ScheduleResult, index: SymbolIndex): DemandMarks | null {
		const project = result.project;
		const scenario = finishScenario(result);
		const analysis = analysisOf(result);
		if (!project || scenario === null || !analysis) return null;
		const t0 = performance.now();
		try {
			const marks = demandOf({
				result,
				scenario,
				index,
				analysis,
				wt: workingTimeOf(project, this.zones),
				availability: availabilityFor(result, scenario),
			});
			try {
				performance.measure(DEMAND_MEASURE, {
					start: t0,
					end: performance.now(),
					detail: { held: marks.held.size, unmet: marks.unmet.size },
				});
			} catch {
				// A runtime without User Timing Level 3 still gets the marks.
			}
			return marks;
		} catch (error) {
			report(error);
			return null;
		}
	}

	#save(next: HeatPrefs): void {
		const was = this.prefs;
		this.prefs = next;
		if (this.#plan === '') return;
		if (this.#zoomKey) {
			if (next.zoom !== was.zoom) writePref(this.#storage, this.#zoomKey(this.#plan), next.zoom);
			// The heatmap's zoom stays what the heatmap chose.
			const theirs = readHeatPrefs(this.#storage, this.#plan).zoom;
			writeHeatPrefs(this.#storage, this.#plan, { ...next, zoom: theirs });
			return;
		}
		writeHeatPrefs(this.#storage, this.#plan, next);
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
				demand: this.#demandFor(i),
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
