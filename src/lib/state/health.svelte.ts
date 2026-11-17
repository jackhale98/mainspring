// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Plan health's state (phase-3.md 6.4, 9.1, 9.7, 10; T18): the report of the newest good result,
 * the settings of the open plan, and whether the panel is open. One per open plan, owned by
 * `AppState`, so the Health button, the phone's status card and the panel read the same count.
 *
 * - **A lazy computation.** The checks, the explainer and the demand are a chunk of their own
 *   (`lib/health/compute.ts`): only this small class, the button and the tabs are in a first
 *   load. The chunk is fetched, and the report made, in an idle task after a result has settled
 *   (`whenIdle`, after the Gantt's analysis, as the heatmap's model is), once per result and index;
 *   until then `count` is null and the button says only its name. A chunk that cannot be fetched
 *   leaves `status` at `failed` (the panel offers "Try again"); the plan is not affected.
 * - **Settings are UI preferences per plan** (settings.ts, ADR-0008 #3), read when a plan opens
 *   and written as they change. A change makes a new report at once from the same result.
 * - **New findings** after a reschedule are announced once per result, as a count ("2 new
 *   problems", WCAG 4.1.3): not for the first report of a plan, and not for a settings change.
 * - **The panel** is `open` on every layout (the right panel's Health tab on a desktop, a bottom
 *   sheet on a tablet, a full-height one on a phone, which stops below the top bar so that Undo
 *   stays in reach); `serial` counts requests to show it, so a
 *   collapsed right panel can open itself without undoing a close the person made.
 * - It reads the plan and the result; it never edits either.
 */
import type { ScheduleResult } from '../../engine/protocol';
import { whenIdle, type Scheduler } from '../gantt/analysis';
import type { Detent } from '../inspector/detent';
import { newFindings, type SeverityFilter } from '../health/panel-model';
import { readHealthSettings, writeHealthSettings } from '../health/settings';
import { DEFAULT_HEALTH_SETTINGS, type HealthReport, type HealthSettings } from '../health/types';
import { strings } from '../strings';
import type { SymbolIndex } from '../tjp/index';
import { browserStorage, type PrefStorage } from './storage';

/** The lazy half: `lib/health/compute.ts`. */
type Compute = Pick<typeof import('../health/compute'), 'computeHealth'>;

export type HealthStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface HealthStateOptions {
	storage?: PrefStorage | null;
	/** Imports the checks; replaced in tests. */
	load?: () => Promise<Compute>;
	schedule?: Scheduler;
}

export class HealthState {
	/** The panel is shown (a tab, or a sheet). */
	open = $state(false);
	/** Counts requests to show the panel (`show()`), for a panel that has to make room for itself. */
	serial = $state(0);
	/** The settings page is shown instead of the findings. */
	settingsOpen = $state(false);
	severity = $state<SeverityFilter>('all');
	/** The sheet's height in px while it is open (the toasts clear it), and how tall it is asked to be. */
	sheetHeight = $state(0);
	detent = $state<Detent>('half');
	settings = $state.raw<HealthSettings>(DEFAULT_HEALTH_SETTINGS);
	report = $state.raw<HealthReport | null>(null);
	/** What the report was made from: the names and dates of its sentences are read from it. */
	basis = $state.raw<{ result: ScheduleResult; index: SymbolIndex } | null>(null);
	status = $state<HealthStatus>('idle');
	/** The polite announcement of the newest result (a live region reads it). */
	announcement = $state('');

	readonly #storage: PrefStorage | null;
	readonly #load: () => Promise<Compute>;
	readonly #schedule: Scheduler;
	#compute: Promise<Compute> | null = null;
	#plan = '';
	#input: { result: ScheduleResult; index: SymbolIndex } | null = null;
	#cancel: (() => void) | null = null;
	#flip = false;
	#disposed = false;

	constructor(o: HealthStateOptions = {}) {
		this.#storage = o.storage === undefined ? browserStorage() : o.storage;
		this.#load = o.load ?? (() => import('../health/compute'));
		this.#schedule = o.schedule ?? whenIdle;
	}

	/** The number of findings, or null before the first report. */
	get count(): number | null {
		return this.report === null ? null : this.report.findings.length;
	}

	/** Switches to a plan's settings (call when the open plan changes). */
	use(plan: string): void {
		if (plan === this.#plan) return;
		this.#plan = plan;
		this.#cancel?.();
		this.#cancel = null;
		this.#input = null;
		this.report = null;
		this.basis = null;
		this.status = 'idle';
		this.announcement = '';
		this.settings = readHealthSettings(this.#storage, plan);
		this.severity = 'all';
		this.settingsOpen = false;
		this.open = false;
	}

	/** The newest good result and the index of its text; makes the report in an idle task. */
	offer(result: ScheduleResult | null, index: SymbolIndex | null): void {
		const cur = this.#input;
		if (result === null || index === null) {
			this.#cancel?.();
			this.#cancel = null;
			this.#input = null;
			this.report = null;
			this.basis = null;
			this.status = 'idle';
			return;
		}
		if (cur && cur.result === result && cur.index === index) return;
		this.#input = { result, index };
		this.#cancel?.();
		this.#cancel = this.#schedule(() => {
			this.#cancel = null;
			void this.#make(true);
		});
	}

	/** Takes new settings (stored for the plan) and makes the report again at once. */
	setSettings(next: HealthSettings): void {
		this.settings = next;
		if (this.#plan !== '') writeHealthSettings(this.#storage, this.#plan, next);
		if (this.#input) void this.#make(false);
	}

	/** Tries the chunk again after a failed fetch. */
	retry(): void {
		this.#compute = null;
		if (this.#input) void this.#make(false);
	}

	show(): void {
		this.open = true;
		this.serial++;
	}

	hide(): void {
		this.open = false;
		this.settingsOpen = false;
		this.sheetHeight = 0;
	}

	toggle(): void {
		if (this.open) this.hide();
		else this.show();
	}

	dispose(): void {
		this.#disposed = true;
		this.#cancel?.();
		this.#cancel = null;
	}

	async #make(announce: boolean): Promise<void> {
		const input = this.#input;
		if (!input) return;
		if (this.report === null) this.status = 'loading';
		let compute: Compute;
		try {
			compute = await (this.#compute ??= this.#load());
		} catch {
			this.#compute = null;
			if (!this.#disposed && this.#input === input) this.status = 'failed';
			return;
		}
		// A newer result, another plan or a closed plan: that one makes its own report.
		if (this.#disposed || this.#input !== input) return;
		const report = compute.computeHealth(input.result, input.index, this.settings);
		if (report === null) {
			this.status = this.report === null ? 'idle' : 'ready';
			return;
		}
		const was = this.report;
		this.report = report;
		this.basis = input;
		this.status = 'ready';
		if (announce && was !== null && was.revision !== report.revision) {
			const n = newFindings(was, report);
			if (n > 0) this.#say(strings.health.newProblems(n));
		}
	}

	/** A live region reads a change of text; the same words twice in a row need a visible change. */
	#say(text: string): void {
		this.#flip = !this.#flip;
		this.announcement = this.#flip ? text : `${text}​`;
	}
}
