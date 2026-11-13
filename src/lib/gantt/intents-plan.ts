// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * `planAction` (intents.ts): one Gantt action to one edit intent. The time actions are in
 * intents-time.ts; the structural ones map one to one onto edit intents, and the edit API decides
 * their refusals.
 */
import type { Minutes, TaskScenarioResult } from '../../engine/protocol';
import { ganttActionStrings as S } from '../strings';
import type { TaskId } from '../tjp/index';
import { factsOf, scenarioOf, type TaskFacts } from './intents-facts';
import { ceilingOf, floorOf, planMove, writtenDriver } from './intents-move';
import { edgeOf, notPossible, planProgress, planResize, planSizeStep } from './intents-time';
import type { ActionContext, GanttAction, LinkRef, MoveKind, Planned } from './intents';

const intent = (i: Extract<Planned, { status: 'intent' }>['intent'], text: string): Planned => ({
	status: 'intent',
	intent: i,
	label: { text, approx: false },
	constraint: false,
});

/** The display name of a task (its name, else its local id, else the id as given). */
function nameIn(ctx: ActionContext, id: TaskId): string {
	const t = ctx.index.tasks.get(id);
	return t?.name ?? t?.localId ?? id;
}

function personIn(ctx: ActionContext, id: string): string {
	return ctx.index.resources.get(id)?.name ?? id;
}

/** The first site behind a line that the text can change (`removeDepends` takes its pair). */
function writtenSite(link: LinkRef): { succ: TaskId; pred: TaskId } | null {
	if (link.state === 'engine') return null;
	for (const s of link.sites) {
		if (s.pred !== null && s.succ !== null && s.textOnly === null) {
			return { succ: s.succ, pred: s.pred };
		}
	}
	return null;
}

export function planAction(a: GanttAction, ctx: ActionContext): Planned {
	const at = (id: string): TaskScenarioResult | null => scenarioOf(ctx.result, id);
	const facts = (id: TaskId): TaskFacts | null => factsOf(ctx.index, ctx.result, id);
	switch (a.type) {
		case 'resize':
		case 'size-step':
		case 'move':
		case 'progress': {
			const f = facts(a.task);
			if (!f) return notPossible('unknown-target');
			if (a.type === 'resize') return planResize(f, a.at, ctx);
			if (a.type === 'size-step') return planSizeStep(f, a.steps, ctx);
			if (a.type === 'move') return planMove(f, a.days, a.kind, ctx, at, (id) => nameIn(ctx, id));
			return planProgress(f, a.percent);
		}
		case 'link':
			return intent(
				{ type: 'addDepends', task: a.succ, target: a.pred },
				S.label.link(nameIn(ctx, a.pred), nameIn(ctx, a.succ)),
			);
		case 'unlink': {
			const site = writtenSite(a.link);
			if (!site) return notPossible('engine-only');
			return intent(
				{ type: 'removeDepends', task: site.succ, target: site.pred },
				S.label.unlink(nameIn(ctx, site.pred), nameIn(ctx, site.succ)),
			);
		}
		case 'reorder':
			return intent(
				{ type: 'moveTask', task: a.task, parent: a.parent, index: a.index },
				S.label.move(nameIn(ctx, a.task)),
			);
		case 'assign':
			return intent(
				{ type: 'addAllocation', task: a.task, resource: a.resource },
				S.label.assign(personIn(ctx, a.resource), nameIn(ctx, a.task)),
			);
		case 'unassign':
			return intent(
				{ type: 'removeAllocation', task: a.task, resource: a.resource },
				S.label.unassign(personIn(ctx, a.resource), nameIn(ctx, a.task)),
			);
		case 'replace-person':
			return intent(
				{ type: 'replaceAllocation', task: a.task, from: a.from, to: a.to },
				S.label.replace(personIn(ctx, a.from), personIn(ctx, a.to), nameIn(ctx, a.task)),
			);
		case 'rename':
			return intent(
				{ type: 'renameTask', task: a.task, name: a.name },
				S.label.rename(nameIn(ctx, a.task), a.name),
			);
		case 'add':
			return intent(
				{ type: 'addTask', parent: a.parent, index: a.index, name: a.name },
				S.label.add(a.name),
			);
		case 'delete':
			return intent({ type: 'deleteTask', task: a.task }, S.label.delete(nameIn(ctx, a.task)));
	}
}

/**
 * The move kind to pre-select when asking (ADR-0008 #2): `gap` when the task is ASAP and its own
 * text writes the dependency that drives it, else `start`. Without the driving analysis the
 * engine's dates decide which written dependency drives.
 */
export function suggestedMoveKind(task: TaskId, ctx: ActionContext): MoveKind {
	const f = factsOf(ctx.index, ctx.result, task);
	if (!f || f.s?.direction === 'alap') return 'start';
	return writtenDriver(f, ctx, (id) => scenarioOf(ctx.result, id)) ? 'gap' : 'start';
}

/**
 * The edge a task's size handle drags (R1): `end` for an ASAP task, `start` for an ALAP one; null
 * when it has no handle (a milestone, a container, a text-only or unscheduled task).
 */
export function resizeEdge(task: TaskId, ctx: ActionContext): 'start' | 'end' | null {
	const f = factsOf(ctx.index, ctx.result, task);
	return f ? edgeOf(f) : null;
}

/**
 * The earliest start the task's own `depends` entries allow in the shown schedule (where
 * TaskJuggler's earliestStart puts it, not snapped): where a move preview of an ASAP task clamps
 * (7.1 R2). Null without one.
 */
export function earliestStart(task: TaskId, ctx: ActionContext): Minutes | null {
	const s = scenarioOf(ctx.result, task);
	return s ? floorOf(s, ctx, (id) => scenarioOf(ctx.result, id)) : null;
}

/** The latest end the task's own `precedes` entries allow: the clamp for an ALAP task. */
export function latestEnd(task: TaskId, ctx: ActionContext): Minutes | null {
	const s = scenarioOf(ctx.result, task);
	return s ? ceilingOf(s, ctx, (id) => scenarioOf(ctx.result, id)) : null;
}
