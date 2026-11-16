// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * `checkRebalance` (rebalance.ts): plan a rebalance drop and dry-run it with the edit API, as
 * `checkAction` does for the Gantt (gantt/intents-check.ts), so that every refusal reaches the
 * heatmap and the lanes with its reason and one sentence, whichever side decided it: the planner's
 * own (`RebalanceRefusal`), the Gantt's for a week move (`NotPossibleReason`), or the edit API's
 * (`RefusalReason`, unchanged: `inherited`, `unsupported-form` for alternatives, `text-only`).
 * Pure: `applyIntent` builds the edit without applying it.
 *
 * - A `reassign` is dry-run as the Gantt's `replace-person` (R7), which plans the same
 *   `replaceAllocation`; the outcome keeps the rebalance label.
 * - A `shift` is the Gantt's `move` with `checkAction`, so it can ask for the move preference.
 *
 * It serves the dry run per target change (7.2) and the cell details' menus. The dispatcher still
 * plans the drop itself when it applies it (`dispatch` for the intent, `dispatchAction` for the
 * move), with its own stale re-plan and `shared-declaration` confirmation.
 */
import { checkAction, type ActionContext, type ActionOutcome } from '../gantt/intents';
import { rebalanceStrings as S } from '../strings';
import type { EditOptions } from '../tjp/edit/types';
import type { WorkspaceSnapshot } from '../workspace/workspace';
import {
	planRebalance,
	type RebalanceAction,
	type RebalancePlan,
	type RebalanceRefusal,
} from './rebalance';

type Refused = Extract<ActionOutcome, { status: 'refused' }>;

export type RebalanceOutcome =
	| Exclude<ActionOutcome, { status: 'refused' }>
	| (Omit<Refused, 'reason'> & { readonly reason: Refused['reason'] | RebalanceRefusal });

/** The sentence for one of the planner's refusals. */
export function rebalanceMessage(
	plan: Extract<RebalancePlan, { status: 'not-possible' }>,
	ctx: Pick<ActionContext, 'index'>,
): string {
	if (plan.reason !== 'via-group') return S.notPossible[plan.reason];
	const g = plan.group;
	return S.notPossible['via-group'](g === undefined ? '' : (ctx.index.resources.get(g)?.name ?? g));
}

/**
 * Plans the drop and dry-runs it on `ws`, the snapshot `ctx.index` was built from. `opts` goes
 * to `applyIntent` (`confirmShared`, `id`).
 */
export function checkRebalance(
	a: RebalanceAction,
	ctx: ActionContext,
	ws: WorkspaceSnapshot,
	opts: EditOptions = {},
): RebalanceOutcome {
	const plan = planRebalance(a, ctx);
	if (plan.status === 'not-possible') {
		return {
			status: 'refused',
			intent: null,
			reason: plan.reason,
			at: plan.at,
			message: rebalanceMessage(plan, ctx),
		};
	}
	if (plan.status === 'action') return checkAction(plan.action, ctx, ws, opts);
	if (plan.intent.type !== 'replaceAllocation') {
		throw new Error(`checkRebalance: unexpected ${plan.intent.type}`);
	}
	const { task, from, to } = plan.intent;
	const out = checkAction({ type: 'replace-person', task, from, to }, ctx, ws, opts);
	return out.status === 'edit' ? { ...out, intent: plan.intent, label: plan.label } : out;
}
