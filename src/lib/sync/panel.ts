// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the Sync panel says and offers for a state (phase-4.md 11.1; T14): pure, so that it is
 * tested without a page, and the panel (components/sync/SyncPanelBody.svelte) only draws it. Part
 * of the panel's lazy chunk.
 *
 * T14 part two adds the provider actions to `PanelAction` and `actionsOf`: Save (a folder), Commit
 * (GitHub, which opens the Commit sheet), Sync, Reconnect and Export. Their buttons go where
 * SyncPanelBody.svelte marks the slots.
 */
import type { Location } from '../storage/types';
import { strings } from '../strings';
import { syncStrings } from '../strings-sync';
import type { Shown } from './shown';

const T = syncStrings.state;

/** The buttons the panel can offer; `copy-text` and `open-here` are T4's (plan-actions.ts). */
export type PanelAction = 'copy-text' | 'open-here';

/** The location line (strings.ts `sync.location`, 11.2). */
export function locationLine(loc: Location): string {
	const L = strings.sync.location;
	switch (loc.kind) {
		case 'browser':
			return L.browser;
		case 'folder':
			return L.folder(loc.name);
		case 'github':
			return L.github(loc.owner, loc.repo, loc.branch, loc.dir);
	}
}

/** What the state means, in one plain sentence. */
export function sentenceOf(s: Shown): string {
	switch (s.kind) {
		case 'sample':
			return T.sample;
		case 'browser-only':
			return T.browserOnly;
		case 'saved':
			return T.saved;
		case 'changes':
			return T.changes(s.files);
		case 'working':
			return T.working[s.what];
		case 'queued':
			return s.why === 'offline' ? T.queued.offline(s.writes) : T.queued[s.why];
		case 'conflict':
			return T.conflict;
		case 'blocked':
			return T.blocked;
		case 'needs-access':
			return T.access[s.access];
		case 'failed':
			if (s.where === 'provider') return T.failedProvider;
			return s.error.kind === 'quota' || s.error.kind === 'not-owner'
				? T.failedStore[s.error.kind]
				: T.failedStore.default;
		case 'read-only':
			return T.readOnly;
	}
}

/**
 * When the plan was last kept, for the states that have a time: a browser-only plan's last autosave
 * (`at` null before the first), a saved plan's save. Null for the other states: the row is not drawn.
 */
export function keptOf(s: Shown): { readonly at: number | null } | null {
	if (s.kind === 'browser-only') return { at: s.savedAt };
	if (s.kind === 'saved') return { at: s.at };
	return null;
}

/** The time as a person reads it: the time alone for today, else the date too. */
export function formatKept(at: number, now: number, locale?: string): string {
	const same = new Date(at).toDateString() === new Date(now).toDateString();
	return new Intl.DateTimeFormat(locale, {
		timeStyle: 'short',
		...(same ? {} : { dateStyle: 'medium' }),
	}).format(at);
}

/**
 * The actions the state offers today. Changes this tab could not keep can be copied out as text;
 * a tab that does not hold the plan can take it ("Open here instead", which asks first when it
 * holds changes the store refused). `readOnly` is separate because a refused tab is both.
 */
export function actionsOf(s: Shown, readOnly: boolean): readonly PanelAction[] {
	const out: PanelAction[] = [];
	if (s.kind === 'failed' && s.where === 'store') out.push('copy-text');
	if (readOnly) out.push('open-here');
	return out;
}
