// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the person details read from a resource's attribute sites, and nothing else: its own sites
 * of a keyword in the top scenario, and one site as the inspector's `FieldState` (own, or text-only
 * with the reason).
 *
 * These are small copies of `ownSites` (tjp/edit/props.ts) and `siteState` (inspector/field.ts). The
 * originals sit in modules that pull the whole edit API in beside them, and a lazy chunk that imports
 * them makes the bundler cut those modules out of the first load's chunk as a shared chunk of their
 * own, which costs the first load about 0.4 KB gzip each (phase-3.md 23.1). The People views are
 * lazy and the first load is capped, so the few lines are repeated here.
 */
import type { FieldState } from '../inspector/field';
import type { AttrSite, SourceRange, SymbolIndex } from '../tjp/index';
import { printNumber, printValue, type TypedValue } from '../tjp/values';
import { compareParseOrder } from '../workspace/include-order';
import type { IncludeGraph } from '../workspace/includes';

/** The own sites of `keyword` among `attrs`, in the top scenario, in reading order. */
export function ownSites(
	index: SymbolIndex,
	attrs: readonly AttrSite[],
	keyword: string,
): AttrSite[] {
	const top = index.scenarios[0]?.id ?? null;
	return attrs.filter((a) => a.keyword === keyword && (a.scenario === null || a.scenario === top));
}

/** A parsed value as a field writes it: a string's text, a number or a date as TaskJuggler does. */
function valueText(v: TypedValue): string | null {
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

export const UNSET: FieldState = { kind: 'unset' };

/**
 * Whether `a` is read before `b` (TaskJuggler's reading order, across included files). A resource
 * takes what its parent group, and the project, hold when it is declared: a statement read after the
 * resource's header does not reach it (the edit API's rule, `props.ts` `inheritedSites`).
 */
export type ReadBefore = (a: SourceRange, b: SourceRange) => boolean;

/** Without the includes of the plan: positions in one file by offset, other files as before. */
export const sameFileBefore: ReadBefore = (a, b) => a.file !== b.file || a.from < b.from;

/** Reading order through the includes of a plan (first visit), as the edit API reads it. */
export const readBeforeOf =
	(includes: IncludeGraph): ReadBefore =>
	(a, b) =>
		compareParseOrder(includes, a, b, 'first') < 0;
