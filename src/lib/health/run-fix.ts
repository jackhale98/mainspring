// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What pressing a finding's fix does (phase-3.md 9.7, section 12; T18). The panel gives this module
 * the app's few doors (`FixEnv`) and the fix, and it calls the right one:
 *
 * - `intent`: one edit through the dispatcher (`env.edit`), so one undo step and the toast of every
 *   other edit; a refusal is the dispatcher's own (its sentence, with "Show in text"). "Edit gap"
 *   is the one intent that takes a value from the person: `withGap` sends the typed gap, or none
 *   (an empty gap removes it).
 * - `pick`: the dependency picker of the task's details (polish item 11, `openDependencyPicker`).
 *   It returns false for a task that is unknown or written by a macro: nothing is selected and the
 *   person is told, since the panel already left the fix disabled where it knew (`Fix.disabled`).
 * - `replace-person`: the chip's "Replace with…", the Gantt action `replace-person`, to a person
 *   the panel's select chose (`replaceWith`).
 * - `open`, `why`, `show`: places to look; the panel closes where it would cover them (`leave`).
 *
 * A fix that is `disabled` (text-only) never runs: the panel does not offer it as a button, it
 * names the reason. Nothing here edits the text itself.
 */
import type { Minutes } from '../../engine/protocol';
import type { GanttAction } from '../gantt/intents';
import type { Edit } from '../inspector/edit';
import type { DispatchOutcome } from '../state/edits.svelte';
import { healthStrings } from '../strings-health-panel';
import type { ResourceId, SourceRange, TaskId } from '../tjp/index';
import type { Finding, Fix } from './types';

export interface FixEnv {
	openDependencyPicker(task: TaskId, role: 'predecessor' | 'successor'): boolean;
	openInWorkload(resource: ResourceId, at: Minutes): void;
	openInCalendar(resource: ResourceId): void;
	showWhy(task: TaskId): void;
	showInText(at: SourceRange): void;
	edit(e: Edit): Promise<DispatchOutcome>;
	action(a: GanttAction): Promise<DispatchOutcome>;
	/** A message of the app's own (a toast). */
	say(message: string): void;
	/**
	 * Closes the panel where it would cover what the fix opens (a sheet always; a desktop's Health
	 * tab for the details and for another view, not for the text beside it); resolves when it is gone.
	 */
	leave(to: 'details' | 'view' | 'text'): Promise<void>;
}

/** What a run came to. */
export type FixOutcome = 'applied' | 'refused' | 'opened' | 'unavailable';

const label = (text: string): Edit['label'] => ({ text, approx: false });

const outcomeOf = (o: DispatchOutcome): FixOutcome =>
	o.status === 'applied' ? 'applied' : 'refused';

/** Runs one fix; `fix` must not be disabled. */
export async function runFix(fix: Fix, finding: Finding, env: FixEnv): Promise<FixOutcome> {
	if (fix.disabled !== null) return 'unavailable';
	switch (fix.kind) {
		case 'intent':
			return outcomeOf(await env.edit({ intent: fix.intent, label: label(fix.label) }));
		case 'pick': {
			await env.leave('details');
			if (env.openDependencyPicker(fix.task, fix.role)) return 'opened';
			env.say(healthStrings.panel.pickGone);
			return 'unavailable';
		}
		case 'replace-person':
			// Needs a person: the panel's select calls `replaceWith`.
			return 'unavailable';
		case 'open':
			await env.leave('view');
			if (fix.view === 'workload') env.openInWorkload(fix.resource, fix.at);
			else env.openInCalendar(fix.resource);
			return 'opened';
		case 'why':
			await env.leave('details');
			env.showWhy(fix.task);
			return 'opened';
		case 'show': {
			if (finding.at === null) return 'unavailable';
			await env.leave('text');
			env.showInText(finding.at);
			return 'opened';
		}
	}
}

/** "Replace Dev…" with a person the select chose. */
export async function replaceWith(
	fix: Extract<Fix, { kind: 'replace-person' }>,
	to: ResourceId,
	env: FixEnv,
): Promise<FixOutcome> {
	if (fix.disabled !== null) return 'unavailable';
	return outcomeOf(
		await env.action({ type: 'replace-person', task: fix.task, from: fix.from, to }),
	);
}

/** "Edit gap": the fix's intent with the gap the person typed; an empty gap removes it. */
export async function withGap(
	fix: Extract<Fix, { kind: 'intent' }>,
	typed: string,
	env: FixEnv,
): Promise<FixOutcome> {
	if (fix.disabled !== null || fix.intent.type !== 'setDependsGap') return 'unavailable';
	const text = typed.trim();
	const kind = fix.intent.gap?.kind ?? 'gaplength';
	const intent = { ...fix.intent, gap: text === '' ? null : { kind, value: text } };
	return outcomeOf(await env.edit({ intent, label: label(fix.label) }));
}

/** Whether a fix needs more than a press: a gap to type, or a person to choose. */
export const needsInput = (fix: Fix): 'gap' | 'person' | null =>
	fix.kind === 'replace-person'
		? 'person'
		: fix.kind === 'intent' && fix.intent.type === 'setDependsGap'
			? 'gap'
			: null;
