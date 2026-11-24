// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * How each state is drawn and said by the sync status control (phase-4.md 11.1, 12.3; T14): its
 * label, its icon, its tone (a colour token) and whether a change into it is announced. Every kind
 * of `Shown` has an entry, so a state T7 adds to `SyncStatus` fails the type check here first.
 *
 * Announcements (12.3): autosave is never announced, so neither is a plain saved or browser-only
 * state, a sample, working or changes. Queued, conflict, blocked, access and failures are, once each
 * (`key` names the state, not its counts: "2 conflicts" becoming "3" is not a new announcement).
 * A read-only tab is told by its own notice (PlanNotice), which is a live region.
 */
import type { IconName } from '../icons';
import { strings } from '../strings';
import type { Shown } from './shown';

const L = strings.sync.label;

/** `neutral` and `ok` need nothing; `attention` is waiting on the person or the network; `error` is a problem. */
export type Tone = 'neutral' | 'ok' | 'busy' | 'attention' | 'error';

export interface StatusView {
	readonly label: string;
	/** An icon of the shared set; `busy` is the ticking mark (the engine's, while something runs). */
	readonly icon: IconName | 'busy';
	readonly tone: Tone;
	/** A change into a state with a new `key` is announced when `say` is true. */
	readonly say: boolean;
	readonly key: string;
}

const view = (
	label: string,
	icon: StatusView['icon'],
	tone: Tone,
	key: string,
	say = false,
): StatusView => ({ label, icon, tone, say, key });

export function viewOf(s: Shown): StatusView {
	switch (s.kind) {
		case 'sample':
			return view(L.sample, 'file', 'neutral', s.kind);
		case 'browser-only':
			return view(strings.sync.location.browser, 'browser', 'neutral', s.kind);
		case 'saved':
			return view(L.saved, 'check', 'ok', s.kind);
		case 'changes':
			return view(L.changes(s.files), 'dot', 'attention', s.kind);
		case 'working':
			return view(L.working[s.what], 'busy', 'busy', s.kind);
		case 'queued':
			return view(L.queued[s.why](s.writes), 'clock', 'attention', `${s.kind}-${s.why}`, true);
		case 'conflict':
			return view(L.conflict(s.conflicts), 'route', 'error', s.kind, true);
		case 'blocked':
			return view(L.blocked, 'alert', 'error', s.kind, true);
		case 'needs-access':
			return view(L.access[s.access], 'retry', 'attention', `${s.kind}-${s.access}`, true);
		case 'failed':
			return view(
				s.where === 'store' ? L.failedStore : L.failedProvider,
				'close',
				'error',
				`${s.kind}-${s.where}-${s.error.kind}`,
				true,
			);
		case 'read-only':
			return view(L.readOnly, 'lock', 'attention', s.kind);
	}
}
