// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * When an applied edit is settled, and how (phase-2.md 6.8 step 5, 11.2; the contract in
 * workspace/run-types.ts). Pure: it reads one published runner state.
 *
 * An edit that produced workspace version `v` settles on the first state where
 * - `latest.workspaceVersion >= v`: the result that includes it. It still schedules when the
 *   result is ok and has no error id that the good run before the edit (`baseline`) did not have.
 *   An ok result with such an error is `new-error`: the plan schedules (the result becomes the
 *   good run the Gantt draws, so the bar follows it), but the edit brought an error, shown with
 *   its place. A result that is not ok is `not-scheduled`, with its first error and place;
 * - `failure.workspaceVersion >= v`: the run that included it failed;
 * - both: the newer revision wins;
 * - `engine === 'failed'` (the engine gave up): every pending edit is `failed`.
 */
import type { EngineMessage, ScheduleResult } from '../../engine/protocol';
import { engineFailureStrings, toastStrings } from '../strings';
import type { WorkspacePath } from '../workspace/paths';
import type { RunnerState } from '../workspace/run-types';
import type { Workspace } from '../workspace/workspace';
import type { SourceRange } from '../tjp/edit/types';

/** A range in the text of one workspace version; mapped forward before it is shown. */
export interface Located {
	readonly file: WorkspacePath;
	readonly from: number;
	readonly to: number;
	readonly version: number;
}

export type Settlement =
	/** The result that includes the edit schedules: drop the pending mark, bars animate. */
	| { readonly status: 'scheduled' }
	/** It schedules, but the result has an error the good run before did not have. */
	| { readonly status: 'new-error'; readonly message: string; readonly at: Located | null }
	/** It applied, but that result does not schedule (11.2). */
	| { readonly status: 'not-scheduled'; readonly message: string; readonly at: Located | null }
	/** The run that included it failed, or the engine gave up. */
	| { readonly status: 'failed'; readonly message: string }
	/** Undone before a result included it (also when it was then redone: a new apply). */
	| { readonly status: 'undone' }
	/** A newer total of the same coalesced gesture replaced it (one undo step per gesture). */
	| { readonly status: 'replaced' }
	/** The plan was closed (another sample opened) before a result included it. */
	| { readonly status: 'dropped' };

export type RunnerView = Pick<
	RunnerState,
	'engine' | 'latest' | 'failure' | 'diagnostics' | 'version' | 'lastGood'
>;

const isError = (m: EngineMessage): boolean => m.level === 'error' || m.level === 'fatal';

/** The error message ids of a result: the baseline an edit is compared with. */
export function errorIdsOf(result: ScheduleResult | null | undefined): ReadonlySet<string> {
	return new Set((result?.messages ?? []).filter(isError).map((m) => m.id));
}

const failed = (kind: keyof typeof engineFailureStrings): Settlement => ({
	status: 'failed',
	message: toastStrings.failed(engineFailureStrings[kind]),
});

/** How state `s` settles an edit that produced workspace version `version`, or null: not yet. */
export function settleOf(
	s: RunnerView,
	version: number,
	baseline: ReadonlySet<string>,
): Settlement | null {
	if (s.engine === 'failed') return failed(s.failure?.error.kind ?? 'crash');
	const r = s.latest !== null && s.latest.workspaceVersion >= version ? s.latest : null;
	const f = s.failure !== null && s.failure.workspaceVersion >= version ? s.failure : null;
	if (f && (!r || f.revision > r.revision)) return failed(f.error.kind);
	if (!r) return null;
	const errors = r.result.messages.filter(isError);
	const fresh = r.result.ok ? errors.filter((m) => !baseline.has(m.id)) : errors;
	if (r.result.ok && fresh.length === 0) return { status: 'scheduled' };
	const first = fresh[0] ?? null;
	const text = first?.text ?? toastStrings.noMessage;
	return r.result.ok
		? { status: 'new-error', message: toastStrings.newError(text), at: placeOf(s, first) }
		: {
				status: 'not-scheduled',
				message: toastStrings.noLongerSchedules(text),
				at: placeOf(s, first),
			};
}

/** Where the state's diagnostics put an engine error (the first error when `m` has no place). */
function placeOf(s: RunnerView, m: EngineMessage | null): Located | null {
	const located = s.diagnostics.filter(
		(d) =>
			d.source === 'engine' && d.severity === 'error' && d.precision !== 'none' && d.file !== null,
	);
	const d = (m && located.find((x) => x.messageId === m.id)) ?? located[0];
	if (!d || d.file === null) return null;
	return { file: d.file, from: d.from, to: d.to, version: s.version };
}

/** A located range in the text as it is now (null once its version is no longer kept). */
export function rangeNow(ws: Workspace, l: Located): SourceRange | null {
	let cs;
	try {
		cs = ws.changesSince(l.version).get(l.file);
	} catch {
		return null;
	}
	const from = cs ? cs.mapPos(l.from, 1) : l.from;
	const to = cs ? cs.mapPos(l.to, -1) : l.to;
	return { file: l.file, from, to: Math.max(from, to) };
}
