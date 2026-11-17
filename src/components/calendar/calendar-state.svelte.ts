// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the Calendar view remembers while the People views switch (phase-3.md 6.7, 9.5): the mode
 * (Select, Paint, Erase), the leave type to paint, whose leave is shown (Everyone or a person), the
 * month in view and the keyboard focus. It is made once by the lazy chunk's entry
 * (PeopleView.svelte), so a switch to the heatmap and back finds the calendar where it was. The
 * selected days are the app's shared selection (`app.selection`), not kept here.
 */
import { defaultLeaveType, type PaintScope } from '../../lib/calendar/paint';
import { typesFor } from '../../lib/calendar/leave-edit';
import type { LeaveType } from '../../lib/tjp/edit/types';

export type CalendarMode = 'select' | 'paint' | 'erase';

export const sameScope = (a: PaintScope, b: PaintScope): boolean =>
	a.kind === b.kind &&
	(a.kind === 'global' || (b.kind === 'resource' && a.resource === b.resource));

export class CalendarState {
	mode = $state<CalendarMode>('select');
	scope = $state.raw<PaintScope>({ kind: 'global' });
	leaveType = $state<LeaveType>('holiday');
	/** The month shown: a block index; -1 until the view has chosen where to start. */
	month = $state(-1);
	/** The day with the keyboard's tab stop, an index into the frame's days. */
	focus = $state<number | null>(null);
	/** Where a Shift-extended selection began. */
	anchor = $state<number | null>(null);
	/** The selected person the view last looked at: only a change of it moves the scope. */
	seenPerson: string | null = null;
	/** The plan these were chosen for: another plan starts again. */
	plan: string | null = null;

	/** Shows another person's leave (or Everyone's); the type follows the scope's kinds. */
	setScope(scope: PaintScope): void {
		this.scope = scope;
		if (!typesFor(scope.kind === 'global').includes(this.leaveType)) {
			this.leaveType = defaultLeaveType(scope);
		}
	}
}
