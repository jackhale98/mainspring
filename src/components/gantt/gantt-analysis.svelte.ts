// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Gantt's driving-path analysis (critical path and float, phase-2.md 6.2): display estimates
 * derived from each result in an idle task (ADR-0007), and the Critical path chip. Kept out of
 * Gantt.svelte, which owns the scroll and zoom.
 *
 * The Gantt draws `result`, not the newest result directly: lib/gantt/analysis.ts (`AnalysisGate`)
 * publishes the result and its analysis as one pair, and with the chip on switches to a new result
 * only once its analysis is ready, so a reschedule never makes the highlight flicker. `watch` must
 * run while a component initialises (it sets up `$effect`s).
 */
import type { ScheduleResult } from '../../engine/protocol';
import {
	AnalysisGate,
	NOTHING_SHOWN,
	chipOf,
	type CriticalChip,
	type ShownAnalysis,
} from '../../lib/gantt/analysis';
import type { DrivingAnalysis } from '../../lib/schedule/critical';

export class GanttAnalysis {
	shown = $state.raw<ShownAnalysis>(NOTHING_SHOWN);
	/** The Critical path chip: on by default. */
	on = $state(true);
	readonly #gate = new AnalysisGate({ publish: (s) => (this.shown = s) });

	/** Follows the newest good result. */
	watch(newest: () => ScheduleResult | null): void {
		$effect(() => this.#gate.offer(newest()));
		$effect(() => () => this.#gate.dispose());
	}

	/** The result to draw: the newest, or the previous one while the chip waits for an analysis. */
	get result(): ScheduleResult | null {
		return this.shown.result;
	}

	/** What the model draws: the shown result's analysis while the chip is on. */
	get drawn(): DrivingAnalysis | null {
		return this.on ? this.shown.analysis : null;
	}

	get chip(): CriticalChip {
		return chipOf(this.shown.analysis, this.on);
	}

	toggle(): void {
		this.on = !this.on;
		this.#gate.setOn(this.on);
	}
}
