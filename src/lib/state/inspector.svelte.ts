// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The inspector's UI state (phase-2.md 9.1 to 9.3): what is open and where, kept apart from the
 * plan. Nothing here is stored (ADR-0008 #3 persists only mode, zoom, collapse and dividers) and
 * nothing changes the plan: the inspector edits through `app.edits`.
 *
 * - `view` is what the Gantt shows (its model, the result and the driving analysis as one pair),
 *   published by Gantt.svelte so that the inspector reads exactly what is drawn.
 * - On a desktop the details are a side panel that is always there while the Gantt is
 *   (`collapsed` hides it). On a tablet or a phone they are a bottom sheet: `sheet` is whether it
 *   is open, `detent` its height (half, or dragged to full). `show()` is a tap on a task;
 *   `focus()` is Enter on a row, which also moves the keyboard focus in (`focusNonce`).
 * - `link` is the selected link (its two tasks). It is the link half of the app's `Selection`
 *   (selection.svelte.ts): a selected task and a selected link exclude each other, so selecting a
 *   task clears it.
 * - `projectOpen` and `source` are the project sheet and the show-source sheet.
 * - `sheetHeight` is the open sheet's height in px, which the chart keeps clear of (WCAG 2.4.11).
 */
import type { ScheduleResult } from '../../engine/protocol';
import type { GanttModel } from '../gantt/model';
import type { DrivingAnalysis } from '../schedule/critical';
import type { TaskId } from '../tjp/index';
import type { Detent } from '../inspector/detent';
import { SelectionState, type LinkSelection } from './selection.svelte';

export type { LinkSelection };

export interface GanttView {
	readonly model: GanttModel;
	/** The result the model draws, and its analysis. */
	readonly result: ScheduleResult | null;
	readonly analysis: DrivingAnalysis | null;
	/** Whether the result describes the text now (links.ts `current`). */
	readonly current: boolean;
}

export class InspectorState {
	view = $state.raw<GanttView | null>(null);
	sheet = $state(false);
	detent = $state<Detent>('half');
	collapsed = $state(false);
	projectOpen = $state(false);
	/** The task whose source the show-source sheet shows. */
	source = $state<TaskId | null>(null);
	focusNonce = $state(0);
	#before: Detent | null = null;
	/** Asks the size field to take the focus ("Set effort"). */
	sizeFocus = $state(0);
	sheetHeight = $state(0);
	/** The details were asked for (Enter), not just a click: a desktop in Split opens its sheet. */
	explicit = $state(false);

	/** The app's selection, whose link half `link` is (a plan of its own when used alone). */
	readonly selection: SelectionState;

	constructor(selection: SelectionState = new SelectionState()) {
		this.selection = selection;
	}

	get link(): LinkSelection | null {
		return this.selection.link;
	}

	/** A tap or click on a task: the sheet layouts open their sheet. */
	show(): void {
		this.sheet = true;
	}

	/** Enter on a row: open the details and move the keyboard focus into them. */
	focus(): void {
		this.sheet = true;
		this.collapsed = false;
		this.explicit = true;
		this.focusNonce++;
	}

	/**
	 * Minimises the open sheet to a peek (the grabber and the header) while a link is made or a row
	 * is lifted, and `unpeek` puts back the height it had, unless the person changed it meanwhile.
	 */
	peek(): void {
		if (!this.sheet || this.detent === 'peek') return;
		this.#before = this.detent;
		this.detent = 'peek';
	}

	unpeek(): void {
		const before = this.#before;
		this.#before = null;
		if (before !== null && this.detent === 'peek') this.detent = before;
	}

	hide(): void {
		this.sheet = false;
		this.explicit = false;
		this.#before = null;
		this.detent = 'half';
		this.sheetHeight = 0;
	}

	showLink(pred: TaskId, succ: TaskId): void {
		this.selection.selectLink(pred, succ);
		this.explicit = true;
		this.show();
	}

	clearLink(): void {
		this.selection.clearLink();
	}

	/** A plan opened: nothing of the old one stays. */
	reset(): void {
		this.hide();
		this.clearLink();
		this.projectOpen = false;
		this.source = null;
	}
}
