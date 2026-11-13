// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the inspector's parts share, set once by InspectorHost.svelte: the app (to read the plan),
 * the actions that go through the edit dispatcher, and the few things the inspector asks of the
 * shell (show a range in the text, which only the shell can do, since the mode is its own).
 */
import { getContext, setContext } from 'svelte';
import type { InspectorActions } from '../../lib/inspector/actions';
import type { AppState } from '../../lib/state/app.svelte';
import type { SourceRange, TaskId } from '../../lib/tjp/index';

export interface InspectorContext {
	readonly app: AppState;
	readonly actions: InspectorActions;
	/** "Show in text": opens the text at a range (Split or Text, the phone's Text tab). */
	showInText(at: SourceRange): void;
	/** Selects a task (a link's end, a dependency) in the chart and the details. */
	openTask(id: TaskId): void;
	/** Opens the link between two tasks in the link inspector. */
	openLink(pred: TaskId, succ: TaskId): void;
}

const KEY = Symbol('inspector');

export const setInspector = (c: InspectorContext): void => void setContext(KEY, c);
export const getInspector = (): InspectorContext => getContext<InspectorContext>(KEY);
