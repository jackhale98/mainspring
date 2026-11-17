// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The edit intents the person details and the resource table make (phase-3.md 7.1 W7, W8), each
 * with the label of its toast and undo entry. Pure, like lib/inspector/edit.ts: a field passes
 * what the person typed or picked and gets the intent to dispatch. The edit API decides whether
 * the value is allowed and writes the minimal text patch; a refusal comes back as a toast with
 * "Show in text".
 *
 * - An empty rate or e-mail removes the statement (`removeResourceAttr`).
 * - `efficiency` and `rate` are TaskJuggler numbers (no sign, a decimal point). A stepper sends the
 *   value it reaches, rounded to hundredths so that 0.05 steps never leave float noise in the text.
 * - `managers` is sent whole, with the ids the groups above give kept in it: that is the edit API's
 *   rule for a list value.
 */
import { resourceStrings as R } from '../strings-resources';
import type { Edit } from '../inspector/edit';
import type { EditIntent } from '../tjp/edit/types';
import type { SymbolIndex } from '../tjp/index';
import { printStringPreferring } from '../tjp/values';
import type { PersonDetails } from './person';

const label = (text: string): Edit['label'] => ({ text, approx: false });

/** A number the way it is written in the plan: at most two decimals, no trailing zeros. */
export const numberText = (n: number): string => String(Math.round(n * 100) / 100);

/** A typed non-negative number, or null when it is not one (TaskJuggler's number has no sign). */
export function parseAmount(text: string): number | null {
	const t = text.trim();
	if (!/^\d+(\.\d+)?$/.test(t)) return null;
	const n = Number(t);
	return Number.isFinite(n) ? n : null;
}

export function efficiencyEdit(d: Pick<PersonDetails, 'id' | 'name'>, n: number): Edit {
	const text = numberText(n);
	return {
		intent: { type: 'setResourceAttr', resource: d.id, attr: 'efficiency', value: text },
		label: label(R.label.efficiency(d.name, text)),
	};
}

/** The rate, typed; empty removes it. Null when the text is not a number. */
export function rateEdit(d: Pick<PersonDetails, 'id' | 'name'>, typed: string): Edit | null {
	const t = typed.trim();
	if (t === '') {
		return {
			intent: { type: 'removeResourceAttr', resource: d.id, attr: 'rate' },
			label: label(R.label.rateCleared(d.name)),
		};
	}
	const n = parseAmount(t);
	if (n === null) return null;
	return {
		intent: { type: 'setResourceAttr', resource: d.id, attr: 'rate', value: t },
		label: label(R.label.rate(d.name, t)),
	};
}

export function emailEdit(d: Pick<PersonDetails, 'id' | 'name'>, typed: string): Edit | null {
	const t = typed.trim();
	if (t === '') {
		return {
			intent: { type: 'removeResourceAttr', resource: d.id, attr: 'email' },
			label: label(R.label.emailCleared(d.name)),
		};
	}
	const printed = printStringPreferring(t, 'double');
	if (!printed.ok) return null;
	return {
		intent: { type: 'setResourceAttr', resource: d.id, attr: 'email', value: printed.value },
		label: label(R.label.email(d.name, t)),
	};
}

/** The managers of a person after a change: own ids `next`, the groups' ids kept. */
export function managersEdit(
	d: Pick<PersonDetails, 'id' | 'name' | 'managers'>,
	next: readonly string[],
	changed: { readonly id: string; readonly name: string; readonly added: boolean },
): Edit {
	const own = next.filter((id) => !d.managers.inherited.includes(id));
	const text = changed.added
		? R.label.managerAdded(d.name, changed.name)
		: R.label.managerRemoved(d.name, changed.name);
	if (own.length === 0 && d.managers.own.length > 0) {
		return {
			intent: { type: 'removeResourceAttr', resource: d.id, attr: 'managers' },
			label: label(text),
		};
	}
	return {
		intent: {
			type: 'setResourceAttr',
			resource: d.id,
			attr: 'managers',
			value: [...new Set([...d.managers.inherited, ...own])],
		},
		label: label(text),
	};
}

export const renameEdit = (id: string, from: string, to: string): Edit => ({
	intent: { type: 'renameResource', resource: id, name: to },
	label: label(R.label.renamed(from, to)),
});

/**
 * What a delete takes with the resource (the edit API removes its members, its `supplement` blocks
 * and every `allocate`, `responsible` and `managers` item naming the subtree): the members and the
 * references, counted from the index, for the toast and the undo entry.
 */
export function deleteScope(
	index: SymbolIndex | null,
	id: string,
): { members: number; references: number } {
	if (!index) return { members: 0, references: 0 };
	const gone = new Set<string>([id]);
	const walk = (r: string): void => {
		for (const c of index.resources.get(r)?.children ?? []) {
			gone.add(c);
			walk(c);
		}
	};
	walk(id);
	let references = index.allocations.filter(
		(a) => a.resource !== null && gone.has(a.resource),
	).length;
	for (const r of index.references) {
		if (r.kind !== 'resource' || r.target === null || !gone.has(r.target)) continue;
		if (
			(r.via === 'responsible' || r.via === 'managers') &&
			!(r.owner !== null && gone.has(r.owner))
		)
			references++;
	}
	return { members: gone.size - 1, references };
}

export const deleteEdit = (id: string, name: string, index: SymbolIndex | null = null): Edit => {
	const { members, references } = deleteScope(index, id);
	return {
		intent: { type: 'deleteResource', resource: id },
		label: label(R.label.deleted(name, members, references)),
	};
};

/** Add person or Add group: a new resource under `parent` at `index`, named as given. */
export function addEdit(
	parent: string | null,
	index: number,
	name: string,
	kind: 'person' | 'group',
): Edit {
	const intent: EditIntent = { type: 'addResource', parent, index, name };
	return {
		intent,
		label: label(kind === 'group' ? R.label.groupAdded(name) : R.label.added(name)),
	};
}
