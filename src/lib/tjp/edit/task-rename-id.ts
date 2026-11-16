// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A new task's id follows its first name (polish item 15; ADR-0013 amendment, 2026-11-16).
 *
 * - `isAutomaticId(local, firstName)`: `local` is an id `addTask` gives a task named `firstName`
 *   when no id is passed: `slugId(firstName, taken)`, so the slug itself or the slug with `_2`,
 *   `_3`, … (slugId counts from 2 and writes no leading zero). For the + control's "New task" that
 *   is `new_task` or `new_task_N`, N >= 2.
 * - `idKept(index, task)`: why the task's id must stay, or null. The id may change only when
 *   nothing could name the task by it (the safe side whenever the index cannot be sure):
 *   1. the task is declared in plain text: a literal id, not expanded-only or text-only, read in
 *      one include visit only (`shared-declaration` otherwise), with no supplement block;
 *   2. it has no children (their full ids would change too);
 *   3. no reference site of any kind (depends, precedes, supplement, allocate, responsible,
 *      managers, flags, taskprefix…) resolves to it or is written as a mention of it, resolved or
 *      not, and no dependency item names it;
 *   4. no macro body or opaque statement (reports, bookings, …) mentions it (`index.mentions`);
 *   5. no file of the plan has a macro call, an environment reference, a macro or automatic
 *      declaration id, an expanded-only declaration or a syntax error anywhere: any of them may
 *      expand to, or hide, a reference the index cannot see;
 *   6. no sibling has an id only the engine knows (`needs-schedule`: a new id could collide).
 * - `followingId(index, task, name, firstName)`: the new local id for `renameTask`'s `id`, or null
 *   to change the name only: the task has an automatic id, `idKept` is null, and the slug of the
 *   new name (addTask's `slugId` with its sibling collision suffix, `taken`) differs from the id.
 * - `planIdChange(ctx, task, id)`: the op that rewrites the id token, or the refusal (`idKept`'s,
 *   `invalid-value`, `id-collision`). The caller verifies the edited tree (task-attrs-names.ts).
 */
import { mentionPattern, type SymbolIndex, type TaskSymbol, type TextOnlyReason } from '../index';
import { isId, slugId } from '../values';
import { replaceSpan } from './layout';
import { dependenciesNaming } from './refs';
import { taken, unknownSibling } from './task-siblings';
import { refused, type EditContext, type EditOp, type Refused } from './types';

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function isAutomaticId(local: string, firstName: string): boolean {
	const base = slugId(firstName);
	return new RegExp(`^${escape(base)}(?:_[2-9]|_[1-9]\\d+)?$`).test(local);
}

/** Text-only reasons that may hide a reference to any id (rule 5). */
const HIDING: ReadonlySet<TextOnlyReason> = new Set<TextOnlyReason>([
	'macro-call',
	'env-var',
	'macro-id',
	'auto-id',
	'expanded-only',
	'syntax-error',
]);

function filesOf(index: SymbolIndex): string[] {
	return [...new Set(index.visits.map((v) => v.file))];
}

export function idKept(index: SymbolIndex, task: string): Refused | null {
	const sym = index.tasks.get(task);
	if (!sym) return refused('unknown-target');
	const at = [sym.decl.header];
	if (sym.expandedOnly) return refused('text-only', at, { textOnly: 'expanded-only' });
	if (sym.textOnly) return refused('text-only', at, { textOnly: sym.textOnly.reason });
	if (sym.idSource !== 'text' || !sym.decl.id) return refused('unsupported-form', at);
	if (sym.sharedWith.length > 0) return refused('shared-declaration', at, { affects: [sym.id] });
	const named = [
		...sym.supplements.map((s) => s.header),
		...sym.children.flatMap((c) => index.tasks.get(c)?.decl.header ?? []),
	];
	if (named.length > 0) return refused('unfixable-reference', named);
	const re = mentionPattern('task', sym.id);
	const mentions = (text: string): boolean => {
		re.lastIndex = 0;
		return re.test(text);
	};
	const refs = [
		...index.references.filter((r) => r.target === sym.id || mentions(r.written)).map((r) => r.at),
		...dependenciesNaming(index, sym.id).map((d) => d.ref),
		...index.mentions('task', sym.id).map((m) => m.at),
	];
	if (refs.length > 0) return refused('unfixable-reference', refs);
	for (const file of filesOf(index)) {
		const hiding = index.textOnly(file).find((t) => HIDING.has(t.reason));
		if (hiding) return refused('text-only', [hiding.at], { textOnly: hiding.reason });
	}
	return unknownSibling({ index }, sym.parent);
}

/**
 * Whether `local` would give a meaning to text that names it now and names nothing: an unresolved
 * task reference, or a mention in a macro body or opaque statement. Such an id counts as taken.
 */
function written(index: SymbolIndex, sym: TaskSymbol, local: string): boolean {
	const full = sym.parent === null ? local : `${sym.parent}.${local}`;
	const re = mentionPattern('task', full);
	const hit = (text: string): boolean => {
		re.lastIndex = 0;
		return re.test(text);
	};
	const dangling = index.references.some(
		(r) => r.kind === 'task' && r.target === null && hit(r.written),
	);
	return dangling || index.mentions('task', full).length > 0;
}

/** The slug of `name` among the task's siblings, by addTask's rules (module comment). */
function slugFor(index: SymbolIndex, sym: TaskSymbol, name: string): string {
	return slugId(
		name,
		(x) => taken({ index }, sym.parent, x, sym.id) || (x !== sym.localId && written(index, sym, x)),
	);
}

export function followingId(
	index: SymbolIndex,
	task: string,
	name: string,
	firstName: string,
): string | null {
	const sym = index.tasks.get(task);
	if (!sym || !isAutomaticId(sym.localId, firstName) || idKept(index, task)) return null;
	const id = slugFor(index, sym, name);
	return id === sym.localId ? null : id;
}

export function planIdChange(ctx: EditContext, sym: TaskSymbol, id: string): EditOp | Refused {
	const at = [sym.decl.header];
	if (!isId(id)) return refused('invalid-value', at);
	const kept = idKept(ctx.index, sym.id);
	if (kept) return kept;
	if (taken(ctx, sym.parent, id, sym.id) || written(ctx.index, sym, id)) {
		return refused('id-collision', at);
	}
	const span = sym.decl.id;
	const file = span ? ctx.ws.files.get(span.file) : undefined;
	if (!span || !file) return refused('unknown-target', at);
	return replaceSpan(file, span, id);
}
