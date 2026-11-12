// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Test-only plan and edit helpers for the schedule runner's unit tests: a one-file plan with a
 * macro id, its task results, typing into it and applying one-change edits. Not imported by
 * application code.
 */
import { changeSetOf } from '../../tjp/document';
import type { Workspace } from '../workspace';
import { task } from './fake-engine-client';

export const PLAN = [
	'macro tid [t1]', // 1
	'project p "P" 2026-01-05 +1m', // 2
	'task ${tid} "Macro task" {', // 3
	'  effort 1d', // 4
	'}', // 5
	'task b "B" {', // 6
	'  effort 2d', // 7
	'}', // 8
	'',
].join('\n');

/** Results for PLAN's two tasks, as the engine reports them before any edit. */
export const TASKS = [task('t1', 3, 600), task('b', 6, 1500)];

export type TypeAt = number | { line: number } | { after: string };

/** Types `insert` into plan.tjp: at an offset, the start of a line, or right after some text. */
export function typeInto(ws: Workspace, insert: string, at: TypeAt = 0): void {
	const state = ws.state('plan.tjp');
	const pos =
		typeof at === 'number'
			? at
			: 'line' in at
				? state.doc.line(at.line).from
				: state.doc.toString().indexOf(at.after) + at.after.length;
	ws.commit('plan.tjp', state.update({ changes: { from: pos, insert } }), 'typing');
}

/** Applies a one-change edit with the given intent type ('format' gives origin 'format'). */
export function applyEdit(ws: Workspace, intent: string, find: string, insert: string): void {
	const file = ws.snapshot().files.get('plan.tjp');
	if (!file) throw new Error('no plan.tjp');
	const from = file.text.toString().indexOf(find);
	const changes = changeSetOf({ from, to: from + find.length, insert }, file.text.length);
	const r = ws.apply({
		id: `e-${intent}`,
		intent: { type: intent },
		base: { 'plan.tjp': file.version },
		changes: { 'plan.tjp': changes },
	});
	if (r !== 'applied') throw new Error(`edit ${intent} was ${r}`);
}

/** The current text of plan.tjp in a range. */
export function sliceOf(ws: Workspace, d: { from: number; to: number }): string {
	return ws.snapshot().files.get('plan.tjp')?.text.sliceString(d.from, d.to) ?? '';
}
