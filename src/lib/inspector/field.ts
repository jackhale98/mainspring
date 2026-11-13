// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the inspector shows for one attribute of a task (phase-2.md 9.3 "Field rules"): read from
 * the symbol index, never from the schedule, so the field says what the text says.
 *
 * - `own`: written on the task itself, in the top scenario or without a scenario. The last such
 *   statement is the one TaskJuggler keeps and the one an edit rewrites (`lastSite`).
 * - `inherited`: not written here, but a parent task sets an attribute TaskJuggler inherits
 *   (priority, scheduling, minstart, maxend, flags, responsible). The field says where it comes
 *   from. This is an approximation of the edit API's `inheritedSites`: it takes the nearest
 *   ancestor that writes the attribute, whatever the order of the parent's statement and the
 *   child's header. It is display only: an edit writes a value on the task itself.
 * - `text-only`: written with a macro or a variable, or in a form the index cannot read. The
 *   inspector does not edit it and offers "Show in text".
 * - `unset`: nothing says anything.
 */
import {
	lastSite,
	type AttrSite,
	type SourceRange,
	type SymbolIndex,
	type TaskId,
	type TaskSymbol,
	type TextOnlyReason,
} from '../tjp/index';
import { printNumber, printValue, type TypedValue } from '../tjp/values';

export type FieldState =
	| { readonly kind: 'unset' }
	| { readonly kind: 'own'; readonly text: string; readonly at: SourceRange }
	| {
			readonly kind: 'inherited';
			readonly text: string;
			readonly from: TaskId;
			readonly fromName: string;
			readonly at: SourceRange;
	  }
	| {
			readonly kind: 'text-only';
			readonly reason: TextOnlyReason | 'unreadable';
			readonly at: SourceRange;
	  };

export const UNSET: FieldState = { kind: 'unset' };

/** The top scenario: unprefixed statements and its own are the ones an edit reads and writes. */
export const topScenario = (index: SymbolIndex): string | null => index.scenarios[0]?.id ?? null;

/** A parsed value as the inspector writes it in a field: a string's text, a date as TJP writes it. */
export function valueText(v: TypedValue): string | null {
	switch (v.kind) {
		case 'string':
			return v.value;
		case 'number': {
			const p = printNumber(v.value);
			return p.ok ? p.value : null;
		}
		case 'idList':
			return v.value.join(', ');
		default: {
			const p = printValue(v);
			return p.ok ? p.value : null;
		}
	}
}

/** The state of one site: its text, or why it cannot be shown or edited. */
export function siteState(site: AttrSite): FieldState {
	if (site.textOnly) return { kind: 'text-only', reason: site.textOnly.reason, at: site.statement };
	const text = site.parsed ? valueText(site.parsed) : null;
	return text === null
		? { kind: 'text-only', reason: 'unreadable', at: site.statement }
		: { kind: 'own', text, at: site.statement };
}

/** The task's own last site of a keyword in the top scenario. */
export function ownSite(index: SymbolIndex, sym: TaskSymbol, keyword: string): AttrSite | null {
	return lastSite(sym.attrs, keyword, null, topScenario(index));
}

/** The nearest ancestor that writes `keyword` (see the module comment), with its field state. */
export function inheritedField(
	index: SymbolIndex,
	sym: TaskSymbol,
	keyword: string,
): FieldState | null {
	const seen = new Set<TaskId>();
	for (let p = sym.parent; p !== null && !seen.has(p);) {
		seen.add(p);
		const up = index.tasks.get(p);
		if (!up) return null;
		const site = ownSite(index, up, keyword);
		if (site) {
			const s = siteState(site);
			return s.kind === 'own'
				? {
						kind: 'inherited',
						text: s.text,
						from: up.id,
						fromName: up.name ?? up.localId,
						at: s.at,
					}
				: s;
		}
		p = up.parent;
	}
	return null;
}

/** One attribute: its own last site, else what a parent sets (only where TaskJuggler inherits). */
export function readField(
	index: SymbolIndex,
	sym: TaskSymbol,
	keyword: string,
	inherits = false,
): FieldState {
	const site = ownSite(index, sym, keyword);
	if (site) return siteState(site);
	return (inherits ? inheritedField(index, sym, keyword) : null) ?? UNSET;
}
