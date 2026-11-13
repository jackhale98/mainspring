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
 * - `link` is a selected link (its two tasks); a selected task and a selected link exclude each
 *   other (AppState.selectTask clears it).
 * - `projectOpen` and `source` are the project sheet and the show-source sheet.
 * - `sheetHeight` is the open sheet's height in px, which the chart keeps clear of (WCAG 2.4.11).
 */
import type { ScheduleResult } from '../../engine/protocol';
import type { GanttModel } from '../gantt/model';
import type { DrivingAnalysis } from '../schedule/critical';
import type { TaskId } from '../tjp/index';
import type { Detent } from '../inspector/detent';

export interface GanttView {
	readonly model: GanttModel;
	/** The result the model draws, and its analysis. */
	readonly result: ScheduleResult | null;
	readonly analysis: DrivingAnalysis | null;
	/** Whether the result describes the text now (links.ts `current`). */
	readonly current: boolean;
}

export interface LinkSelection {
	readonly pred: TaskId;
	readonly succ: TaskId;
}

export class InspectorState {
	view = $state.raw<GanttView | null>(null);
	sheet = $state(false);
	detent = $state<Detent>('half');
	collapsed = $state(false);
	link = $state.raw<LinkSelection | null>(null);
	projectOpen = $state(false);
	/** The task whose source the show-source sheet shows. */
	source = $state<TaskId | null>(null);
	focusNonce = $state(0);
	/** Asks the size field to take the focus ("Set effort"). */
	sizeFocus = $state(0);
	sheetHeight = $state(0);
	/** The details were asked for (Enter), not just a click: a desktop in Split opens its sheet. */
	explicit = $state(false);

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

	hide(): void {
		this.sheet = false;
		this.explicit = false;
		this.detent = 'half';
		this.sheetHeight = 0;
	}

	showLink(pred: TaskId, succ: TaskId): void {
		this.link = { pred, succ };
		this.explicit = true;
		this.show();
	}

	clearLink(): void {
		this.link = null;
	}

	/** A plan opened: nothing of the old one stays. */
	reset(): void {
		this.hide();
		this.link = null;
		this.projectOpen = false;
		this.source = null;
	}
}
