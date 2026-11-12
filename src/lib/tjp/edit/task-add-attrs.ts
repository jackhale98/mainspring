// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The attributes of a new task (`addTask` `attrs`, phase-1.md 7.1) through the task attribute
 * intents (T11a, task-attrs.ts), so a new block reads, prints and checks its values exactly as
 * `setAttr` does on an existing task: TaskJuggler text only (`note` too), canonical printing, the
 * 7.2 order, `flags` declared before the block (`undeclared-flag`), `responsible` resources
 * written below the file's `resourceprefix` (`invalid-value`), sizing, milestone and timing
 * checks (`conflicting-attribute`).
 *
 * The bare block is inserted first; each attribute is then a `setAttr` plan on the workspace as
 * it is after the previous step (indexed with the carried engine hints, task-verify.ts
 * `afterEdit`). The change sets of all steps are composed, so the result is a set of changes to
 * the original text (normally the single insertion of the whole block). A refusal of any step
 * refuses the intent, at `at` (the steps' ranges belong to texts that do not exist yet).
 */
import type { ChangeSet } from '@codemirror/state';
import type { TaskId } from '../index';
import { TASK_ATTR_HANDLERS } from './task-attrs';
import { afterEdit } from './task-verify';
import {
	isNoop,
	isRefused,
	refused,
	type AttrValue,
	type EditContext,
	type EditOp,
	type IntentOf,
	type Refused,
	type SourceRange,
	type TaskAttr,
} from './types';

const same = (id: TaskId): TaskId => id;

/** The ops of the bare insertion plus the attributes, in the original text's coordinates. */
export function withAttrs(
	ctx: EditContext,
	bare: readonly EditOp[],
	task: TaskId,
	attrs: ReadonlyArray<readonly [TaskAttr, AttrValue]>,
	at: readonly SourceRange[],
): EditOp[] | Refused {
	if (attrs.length === 0) return [...bare];
	let state = afterEdit(ctx, bare, same);
	const composed = new Map<string, ChangeSet>(state.changes);
	for (const [attr, value] of attrs) {
		const sub: EditContext = { ws: state.snap, index: state.index, opts: ctx.opts };
		const intent: IntentOf<'setAttr'> = { type: 'setAttr', task, attr, value };
		const plan = TASK_ATTR_HANDLERS.setAttr.plan(sub, intent);
		if (isRefused(plan)) {
			const extra = plan.textOnly === undefined ? {} : { textOnly: plan.textOnly };
			return refused(plan.reason, at, extra);
		}
		if (isNoop(plan)) continue;
		const next = afterEdit(sub, plan, same);
		for (const [path, cs] of next.changes) {
			const prev = composed.get(path);
			composed.set(path, prev ? prev.compose(cs) : cs);
		}
		state = next;
	}
	const out: EditOp[] = [];
	for (const [file, cs] of composed) {
		cs.iterChanges((from, to, _fromB, _toB, inserted) => {
			const insert = inserted.toString();
			out.push({ file, from, to, insert, element: { from, to } });
		});
	}
	return out;
}
