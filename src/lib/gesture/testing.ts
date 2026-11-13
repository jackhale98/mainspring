// SPDX-License-Identifier: GPL-2.0-or-later
/** Builders for the gesture tests: synthetic pointer sequences without a DOM. */
import { describe, expect, it } from 'vitest';
import { createGestureMachine } from './machine';
import {
	NO_MODIFIERS,
	type GestureHooks,
	type GestureInput,
	type GestureMachine,
	type GestureOutput,
	type GestureState,
	type GestureTarget,
	type PointerInput,
	type PointerKind,
} from './types';

export const BODY: GestureTarget = { kind: 'bar', row: 2, part: 'body' };
export const END_HANDLE: GestureTarget = { kind: 'bar', row: 2, part: 'end-handle' };
export const LINK_DOT: GestureTarget = { kind: 'bar', row: 2, part: 'link-dot' };
export const PROGRESS: GestureTarget = { kind: 'bar', row: 2, part: 'progress' };
export const OTHER_BAR: GestureTarget = { kind: 'bar', row: 5 };
export const ROW_HANDLE: GestureTarget = { kind: 'row-handle', row: 2 };
export const EMPTY: GestureTarget = { kind: 'empty', row: 2, at: 0 };
export const LINK: GestureTarget = { kind: 'link', link: 0 };

interface Opts {
	id?: number;
	target?: GestureTarget;
	buttons?: number;
}

function ptr(
	type: PointerInput['type'],
	kind: PointerKind,
	x: number,
	y: number,
	t: number,
	o: Opts,
): PointerInput {
	return {
		type,
		id: o.id ?? 1,
		kind,
		x,
		y,
		t,
		target: o.target ?? BODY,
		// A mouse button is held from down to the last move; the final up reports none.
		buttons: o.buttons ?? (type === 'up' || type === 'cancel' ? 0 : 1),
		modifiers: NO_MODIFIERS,
	};
}

export const down = (kind: PointerKind, x: number, y: number, t: number, o: Opts = {}) =>
	ptr('down', kind, x, y, t, o);
export const move = (kind: PointerKind, x: number, y: number, t: number, o: Opts = {}) =>
	ptr('move', kind, x, y, t, o);
export const up = (kind: PointerKind, x: number, y: number, t: number, o: Opts = {}) =>
	ptr('up', kind, x, y, t, o);
export const cancel = (kind: PointerKind, x: number, y: number, t: number, o: Opts = {}) =>
	ptr('cancel', kind, x, y, t, o);
export const timer = (t: number): GestureInput => ({ type: 'timer', t });
export const scroll = (t: number): GestureInput => ({ type: 'scroll', t });
export const ESCAPE: GestureInput = { type: 'escape' };

/** Sends every event and returns all outputs in order. */
export function run(m: GestureMachine, events: readonly GestureInput[]): GestureOutput[] {
	const out: GestureOutput[] = [];
	for (const e of events) out.push(...m.send(e));
	return out;
}

export const kinds = (outs: readonly { type: string }[]): string[] => outs.map((o) => o.type);

/** A table row: a synthetic pointer sequence, the output types it must give, and the end state. */
export interface Case {
	name: string;
	events: GestureInput[];
	out: string[];
	state: GestureState;
	hooks?: GestureHooks;
}

export function runCases(title: string, cases: readonly Case[]): void {
	describe(title, () => {
		it.each(cases)('$name', ({ events, out, state, hooks }) => {
			const m = createGestureMachine({}, hooks);
			expect(kinds(run(m, events))).toEqual(out);
			expect(m.state).toBe(state);
		});
	});
}
