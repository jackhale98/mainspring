// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Gantt's driving-path analysis (critical path and float, phase-2.md 6.2): display estimates
 * derived from the shown result once, in an idle task (lib/gantt/analysis.ts, ADR-0007), and the
 * Critical path chip's state. Kept out of Gantt.svelte, which owns the scroll and zoom.
 *
 * `watch` must run while a component initialises (it sets up an `$effect`). An analysis of an
 * older result stays here until the new one is ready, but the model draws an analysis only over
 * the result revision it came from (model.ts), so nothing stale is shown in between.
 */
import type { ScheduleResult } from '../../engine/protocol';
import { analyseWhenIdle } from '../../lib/gantt/analysis';
import type { DrivingAnalysis } from '../../lib/schedule/critical';
import { strings } from '../../lib/strings';

export interface CriticalChip {
	/** False until the analysis exists: the chip is then `aria-disabled` and says why. */
	readonly available: boolean;
	readonly pressed: boolean;
	/** What the chip describes: why it is unavailable, or that the values are estimates. */
	readonly why: string;
	/** Shown while the chip is on and nothing is highlighted: the whole path is already done. */
	readonly note: string | null;
}

export class GanttAnalysis {
	analysis = $state.raw<DrivingAnalysis | null>(null);
	/** The Critical path chip: on by default. */
	on = $state(true);

	/** Follows the shown result: analyses each new one in an idle task. */
	watch(result: () => ScheduleResult | null): void {
		$effect(() => {
			const r = result();
			if (!r) {
				this.analysis = null;
				return;
			}
			return analyseWhenIdle(r, (a) => (this.analysis = a));
		});
	}

	/** What the model draws: the analysis while the chip is on. */
	get shown(): DrivingAnalysis | null {
		return this.on ? this.analysis : null;
	}

	get chip(): CriticalChip {
		const a = this.analysis;
		const done = !!a && a.critical.size === 0 && a.path.size > 0;
		return {
			available: a !== null,
			pressed: this.on,
			why: a === null ? strings.gantt.criticalUnavailable : strings.gantt.estimate.hint,
			note: this.on && done ? strings.gantt.estimate.allDone : null,
		};
	}

	toggle(): void {
		this.on = !this.on;
	}
}
