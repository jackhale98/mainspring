// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * `checkAction` (intents.ts): plan a Gantt action and dry-run its intent with the edit API, so
 * that every refusal reaches the UI with its reason and one sentence, whichever side decided it.
 * Pure: `applyIntent` builds the edit without applying it.
 */
import type { WorkspaceSnapshot } from '../workspace/workspace';
import { refusalStrings, ganttActionStrings as S } from '../strings';
import { applyIntent } from '../tjp/edit/apply';
import type {
	EditIntent,
	EditOptions,
	NoopReason,
	RefusalReason,
	SourceRange,
	TjpEdit,
} from '../tjp/edit/types';
import type { TextOnlyReason } from '../tjp/index';
import { planAction } from './intents-plan';
import type {
	ActionContext,
	GanttAction,
	MoveKind,
	NotPossibleReason,
	ToastLabel,
} from './intents';

/** Every reason an action can be refused for: the Gantt's own, then the edit API's. */
export type ActionRefusal = NotPossibleReason | RefusalReason;

export type ActionOutcome =
	| {
			readonly status: 'edit';
			readonly intent: EditIntent;
			readonly label: ToastLabel;
			readonly constraint: boolean;
			readonly edit: TjpEdit;
	  }
	| {
			readonly status: 'noop';
			readonly intent: EditIntent;
			readonly reason: NoopReason;
			readonly message: string;
	  }
	| {
			readonly status: 'refused';
			/** Null when the Gantt refused before an intent was built. */
			readonly intent: EditIntent | null;
			readonly reason: ActionRefusal;
			readonly at: readonly SourceRange[];
			readonly message: string;
			readonly textOnly?: TextOnlyReason;
			readonly affects?: readonly string[];
	  }
	| { readonly status: 'ask-move-preference'; readonly suggested: MoveKind };

const isGantt = (r: ActionRefusal): r is NotPossibleReason => r in S.notPossible;

/** The sentence for a refusal, from strings.ts. */
export function refusalMessage(reason: ActionRefusal): string {
	return isGantt(reason) ? S.notPossible[reason] : refusalStrings[reason];
}

/**
 * Plans the action and dry-runs it on `ws`, the snapshot `ctx.index` was built from. `opts` goes
 * to `applyIntent` (`confirmShared`, `id`).
 */
export function checkAction(
	a: GanttAction,
	ctx: ActionContext,
	ws: WorkspaceSnapshot,
	opts: EditOptions = {},
): ActionOutcome {
	const planned = planAction(a, ctx);
	if (planned.status === 'ask-move-preference') return planned;
	if (planned.status === 'not-possible') {
		return {
			status: 'refused',
			intent: null,
			reason: planned.reason,
			at: planned.at,
			message: refusalMessage(planned.reason),
		};
	}
	const r = applyIntent(ws, ctx.index, planned.intent, opts);
	if (r.status === 'edit') {
		return {
			status: 'edit',
			intent: planned.intent,
			label: planned.label,
			constraint: planned.constraint,
			edit: r.edit,
		};
	}
	if (r.status === 'noop') {
		return { status: 'noop', intent: planned.intent, reason: r.reason, message: S.noop[r.reason] };
	}
	return {
		status: 'refused',
		intent: planned.intent,
		reason: r.reason,
		at: r.at,
		message: refusalMessage(r.reason),
		...(r.textOnly === undefined ? {} : { textOnly: r.textOnly }),
		...(r.affects === undefined ? {} : { affects: r.affects }),
	};
}
