// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Resource tree intents (phase-1.md 7.1 `addResource`, `deleteResource`, `moveResource`,
 * `renameResource`: "as the task forms"; 14.9). Resource ids are global (`resourceprefix` only
 * sets the parent of resources declared in an included file), so moving a resource changes no
 * reference. Placement and re-indenting are in blocks.ts.
 *
 * - `addResource` inserts `resource <id> "<name>"`, with a body for `attrs` (7.2 resource order),
 *   at the child place (blocks.ts); a first root goes before the first top-level task, else at the
 *   end of the entry file. The id is the given one (`id-collision` when any resource has it,
 *   TaskJuggler's resource_exists; `invalid-value` when it is not an id) or a slug of the name
 *   with an `_n` suffix on collision. Names holding `${`, `$(` or a line break are `unsafe-text`.
 *   Attribute values are checked as `setResourceAttr` checks them.
 * - `deleteResource` removes the block with its attached comments, the `supplement resource`
 *   blocks of its subtree, and every `allocate`, `responsible` and `managers` item naming the
 *   subtree (7.2 list rules: a list left empty goes with its line). `unfixable-reference` for
 *   mentions in macro bodies and opaque statements (bookings, `limits`, reports, allocation
 *   alternatives), references the index blocks and `resourceprefix` uses (refs.ts). Leaving an
 *   effort leaf task with no allocation is `conflicting-attribute` (effort_no_allocations, as the
 *   allocation intents refuse it).
 * - `moveResource` cuts the block and inserts it re-indented at the child place, possibly in
 *   another file. Refused: `cycle` into its own subtree; noop at the same place; across files with
 *   different `resourceprefix` (the ids in the block would read differently) `unsupported-form`;
 *   moving it later in reading order past an allocation of its subtree (TaskJuggler resolves
 *   `allocate` ids while it parses), or with a mention the edit cannot see, `unfixable-reference`.
 * - `addResource` and `moveResource` under a leaf resource make it a group: `conflicting-attribute`
 *   when it must stay a leaf, because a resource has it as manager (manager_is_group), it has
 *   bookings (booking_group), or opaque text names it, as a task's `limits { resources … }` does
 *   (leaf_resource_id_expected; all three seen in the engine check).
 * - `moveResource` of a subtree that assigns `shifts` under a parent whose chain assigns shifts too
 *   is `conflicting-attribute`: children inherit shift assignments, and overlapping ones are an
 *   error (shift_assignment_overlap).
 * - `renameResource` rewrites the name string only, in its quote style (a cut-here name becomes
 *   double-quoted), escaping that quote; `unsafe-text` as above; noop for the same name.
 *
 * Only `renameResource` means the same in every include visit of a shared file (15.16).
 */
import type { TjpFile } from '../document';
import type { ResourceSymbol, SourceRange } from '../index';
import { compareParseOrder } from '../../workspace/include-order';
import { isId, parseString, printString, printStringPreferring, slugId } from '../values';
import type { IntentHandler } from './apply';
import { childPlace, insertBlock, movedText, targetIndent, type ChildPlace } from './blocks';
import { stateReader } from './dep-graph';
import { rangeKey } from './deps-links';
import {
	fileText,
	indentUnit,
	lineBreakNear,
	removeStatements,
	replaceSpan,
	type Placement,
	type Removal,
} from './layout';
import { removeItems } from './lists';
import { fileOf, resourceOf } from './props';
import { checkReferences, subtree } from './refs';
import { checkSafeText, checkTextOnly } from './refuse';
import { attrStatements } from './resource-attrs';
import {
	isRefused,
	noop,
	refused,
	type EditContext,
	type EditOp,
	type IntentOf,
	type IntentPlan,
	type Refused,
} from './types';

const symbols = (ctx: EditContext, ids: readonly string[]): ResourceSymbol[] =>
	ids.flatMap((id) => {
		const s = ctx.index.resources.get(id);
		return s ? [s] : [];
	});

/** Where a first root resource goes: before the first top-level task, else at the end. */
function firstRoot(ctx: EditContext): { file: TjpFile; place: Placement } | Refused {
	const task = ctx.index.taskRoots.map((id) => ctx.index.tasks.get(id)).find((t) => t && !t.parent);
	const block = task?.decl.block;
	const file = ctx.ws.files.get(block?.file ?? ctx.ws.entry);
	if (!file) return refused('unknown-target');
	return { file, place: block ? { before: block } : 'end' };
}

/**
 * `conflicting-attribute` when `parent` is a leaf that must stay one: some resource has it as
 * manager (manager_is_group), it has bookings (booking_group), or opaque text or a macro body
 * names it, as a `limits` resource list does (leaf_resource_id_expected).
 */
function leafBecomesGroup(ctx: EditContext, parent: ResourceSymbol | null): Refused | null {
	if (!parent || parent.children.length > 0) return null;
	const at = ctx.index.references
		.filter((r) => r.kind === 'resource' && r.via === 'managers' && r.target === parent.id)
		.map((r) => r.at);
	at.push(...parent.attrs.filter((a) => a.keyword === 'booking').map((a) => a.statement));
	for (const m of ctx.index.mentions('resource', parent.id)) at.push(m.at);
	return at.length > 0 ? refused('conflicting-attribute', at) : null;
}

const shiftSites = (r: ResourceSymbol): SourceRange[] =>
	r.attrs.filter((a) => a.keyword === 'shifts').map((a) => a.statement);

/**
 * `conflicting-attribute` when the moved subtree assigns shifts and the new parent or one of its
 * ancestors does too: a child inherits its parent's shift assignments, and TaskJuggler rejects
 * overlapping ones (shift_assignment_overlap, seen in the engine check).
 */
function shiftsOverlap(
	ctx: EditContext,
	parent: ResourceSymbol | null,
	ids: readonly string[],
): Refused | null {
	let inherits = false;
	for (
		let p = parent;
		p;
		p = p.parent === null ? null : (ctx.index.resources.get(p.parent) ?? null)
	)
		if (shiftSites(p).length > 0) inherits = true;
	if (!inherits) return null;
	const at = symbols(ctx, ids).flatMap(shiftSites);
	return at.length > 0 ? refused('conflicting-attribute', at) : null;
}

function parentOf(ctx: EditContext, id: string | null): ResourceSymbol | null | Refused {
	return id === null ? null : resourceOf(ctx, id);
}

function siblingsOf(
	ctx: EditContext,
	parent: ResourceSymbol | null,
	skip?: string,
): ResourceSymbol[] {
	const ids = parent ? parent.children : ctx.index.resourceRoots;
	return symbols(
		ctx,
		ids.filter((id) => id !== skip),
	);
}

export function planAddResource(ctx: EditContext, intent: IntentOf<'addResource'>): IntentPlan {
	const parent = parentOf(ctx, intent.parent);
	if (isRefused(parent)) return parent;
	const at = parent ? [parent.decl.header] : [];
	const unsafe = checkSafeText(intent.name, at);
	if (unsafe) return unsafe;
	const name = printString(intent.name);
	if (!name.ok) return refused('unsafe-text', at);
	const taken = (id: string): boolean => ctx.index.resources.has(id);
	let id = intent.id;
	if (id !== undefined) {
		if (!isId(id)) return refused('invalid-value', at);
		const other = ctx.index.resources.get(id);
		if (other) return refused('id-collision', [other.decl.header]);
	} else id = slugId(intent.name, taken);
	const group = leafBecomesGroup(ctx, parent);
	if (group) return group;
	const where = childPlace(ctx, parent, siblingsOf(ctx, parent), intent.index, () =>
		firstRoot(ctx),
	);
	if (isRefused(where)) return where;
	const body = attrStatements(ctx, id, intent.attrs ?? [], where.file.path, at);
	if (isRefused(body)) return body;
	const header = `resource ${id} ${name.value}`;
	const text = body.length > 0 ? `${header} {\n${body.map((l) => `\t${l}`).join('\n')}\n}` : header;
	const indent = targetIndent(where.file, where.owner);
	if (indent === null) return refused('unknown-target', where.owner ? [where.owner] : []);
	const unit = indentUnit(where.file);
	const eol = lineBreakNear(fileText(where.file), where.owner?.from ?? 0);
	const rendered = text
		.split('\n')
		.map((l, i) => (i === 0 ? l : indent + l.replace(/^\t+/, (t) => unit.repeat(t.length))))
		.join(eol);
	return insertBlock(where, rendered, { from: 0, to: header.length });
}

/** Effort leaves that would keep no allocation once `gone` is deleted (module comment). */
function effortLeft(ctx: EditContext, gone: ReadonlySet<string>): Refused | null {
	const read = stateReader(ctx.ws, ctx.index);
	const at: SourceRange[] = [];
	for (const task of ctx.index.tasks.values()) {
		if (task.children.length > 0) continue;
		const effort = task.attrs.filter((a) => a.keyword === 'effort');
		if (effort.length === 0) continue;
		const allocs = read(task.id).state.allocs;
		if (allocs.length === 0 || !allocs.some((r) => r !== null && gone.has(r))) continue;
		if (allocs.every((r) => r !== null && gone.has(r))) at.push(...effort.map((a) => a.statement));
	}
	return at.length > 0 ? refused('conflicting-attribute', at) : null;
}

const insideAny = (r: SourceRange, list: readonly SourceRange[]): boolean =>
	list.some((o) => o.file === r.file && o.from <= r.from && r.to <= o.to);

export function planDeleteResource(
	ctx: EditContext,
	intent: IntentOf<'deleteResource'>,
): IntentPlan {
	const sym = resourceOf(ctx, intent.resource);
	if (isRefused(sym)) return sym;
	const { index } = ctx;
	const ids = subtree(index, 'resource', sym.id);
	const gone = new Set(ids);
	const removals: Array<{ at: SourceRange; leading: SourceRange | null }> = [
		{ at: sym.decl.block, leading: sym.decl.leadingComments },
	];
	for (const s of symbols(ctx, ids)) {
		for (const sup of s.supplements) {
			if (
				!insideAny(
					sup.block,
					removals.map((r) => r.at),
				)
			)
				removals.push({ at: sup.block, leading: sup.leadingComments });
		}
	}
	const blocks = removals.map((r) => r.at);
	const unfixable = checkReferences(index, 'resource', ids, blocks);
	if (unfixable) return unfixable;
	const left = effortLeft(ctx, gone);
	if (left) return left;
	const byStatement = new Map<string, { statement: SourceRange; items: SourceRange[] }>();
	const add = (statement: SourceRange, item: SourceRange): void => {
		if (insideAny(item, blocks)) return;
		const g = byStatement.get(rangeKey(statement)) ?? { statement, items: [] };
		if (!g.items.some((i) => rangeKey(i) === rangeKey(item))) g.items.push(item);
		byStatement.set(rangeKey(statement), g);
	};
	for (const a of index.allocations)
		if (a.resource && gone.has(a.resource)) add(a.statement, a.item);
	for (const r of index.references) {
		if (r.kind !== 'resource' || r.target === null || !gone.has(r.target)) continue;
		if (r.via !== 'responsible' && r.via !== 'managers') continue;
		const stmt = listStatement(ctx, r.at, r.via);
		if (!stmt) return refused('unfixable-reference', [r.at]);
		add(stmt, r.at);
	}
	const ops: EditOp[] = [];
	const byFile = new Map<string, Removal[]>();
	for (const r of removals) {
		const list = byFile.get(r.at.file) ?? [];
		list.push({ stmt: r.at, leading: r.leading });
		byFile.set(r.at.file, list);
	}
	for (const [path, list] of byFile) {
		const file = ctx.ws.files.get(path);
		if (!file) return refused('unknown-target');
		ops.push(...removeStatements(file, list));
	}
	for (const { statement, items } of byStatement.values()) {
		const file = ctx.ws.files.get(statement.file);
		if (!file) return refused('unknown-target', [statement]);
		const r = removeItems(file, statement, items);
		if (isRefused(r)) return r;
		ops.push(...r);
	}
	return ops;
}

/** The `responsible` or `managers` statement holding a reference token. */
function listStatement(ctx: EditContext, at: SourceRange, via: string): SourceRange | null {
	const attrs = [
		...[...ctx.index.tasks.values()].flatMap((t) => t.attrs),
		...[...ctx.index.resources.values()].flatMap((r) => r.attrs),
	];
	const s = attrs.find(
		(a) =>
			a.keyword === via &&
			a.statement.file === at.file &&
			a.statement.from <= at.from &&
			at.to <= a.statement.to,
	);
	return s?.statement ?? null;
}

/** The written resource prefix of a file's first visit. */
function prefixKey(ctx: EditContext, file: string): string {
	const p = ctx.index.visits.find((v) => v.file === file)?.resourcePrefix ?? { kind: 'none' };
	return p.kind === 'id' ? `id:${p.id}` : p.kind;
}

/** `unfixable-reference` when the new place is later than uses of the subtree (module comment). */
function readsLater(
	ctx: EditContext,
	sym: ResourceSymbol,
	ids: ReadonlySet<string>,
	where: ChildPlace,
): Refused | null {
	const anchor = where.place;
	const pos =
		typeof anchor === 'object' && 'after' in anchor
			? { file: where.file.path, from: anchor.after.to }
			: typeof anchor === 'object' && 'before' in anchor
				? { file: where.file.path, from: anchor.before.from }
				: { file: where.file.path, from: where.owner?.to ?? fileText(where.file).length };
	const old = { file: sym.decl.block.file, from: sym.decl.block.from };
	if (compareParseOrder(ctx.ws.includes, pos, old, 'first') <= 0) return null;
	const at = ctx.index.allocations
		.filter((a) => a.resource !== null && ids.has(a.resource))
		.filter((a) => compareParseOrder(ctx.ws.includes, a.item, pos, 'first') < 0)
		.map((a) => a.item);
	for (const id of ids) for (const m of ctx.index.mentions('resource', id)) at.push(m.at);
	const outside = at.filter((r) => !insideAny(r, [sym.decl.block]));
	return outside.length > 0 ? refused('unfixable-reference', outside) : null;
}

export function planMoveResource(ctx: EditContext, intent: IntentOf<'moveResource'>): IntentPlan {
	const sym = resourceOf(ctx, intent.resource);
	if (isRefused(sym)) return sym;
	const parent = parentOf(ctx, intent.parent);
	if (isRefused(parent)) return parent;
	const ids = subtree(ctx.index, 'resource', sym.id);
	if (parent && ids.includes(parent.id)) return refused('cycle', [parent.decl.header]);
	const siblings = siblingsOf(ctx, parent, sym.id);
	const before = siblingsOf(ctx, parent).findIndex((s) => s.id === sym.id);
	const i = Math.max(0, Math.min(intent.index, siblings.length));
	if (sym.parent === (parent?.id ?? null) && before === i) return noop('already-set');
	const group = leafBecomesGroup(ctx, parent) ?? shiftsOverlap(ctx, parent, ids);
	if (group) return group;
	const where = childPlace(ctx, parent, siblings, i, () => firstRoot(ctx));
	if (isRefused(where)) return where;
	const src = fileOf(ctx, sym.decl.block);
	if (isRefused(src)) return src;
	if (src.path !== where.file.path && prefixKey(ctx, src.path) !== prefixKey(ctx, where.file.path))
		return refused('unsupported-form', [sym.decl.header]);
	const later = readsLater(ctx, sym, new Set(ids), where);
	if (later) return later;
	const indent = targetIndent(where.file, where.owner);
	if (indent === null) return refused('unknown-target', where.owner ? [where.owner] : []);
	const eol = lineBreakNear(fileText(where.file), where.owner?.from ?? 0);
	const moved = movedText(src, sym.decl.block, indent, indentUnit(where.file), eol);
	const header = sym.decl.header;
	const select = { from: moved.header, to: moved.header + (header.to - header.from) };
	const ins = insertBlock(where, moved.text, select);
	if (isRefused(ins)) return ins;
	const cut = removeStatements(src, [{ stmt: sym.decl.block, leading: sym.decl.leadingComments }]);
	return [...cut, ...ins];
}

export function planRenameResource(
	ctx: EditContext,
	intent: IntentOf<'renameResource'>,
): IntentPlan {
	const sym = resourceOf(ctx, intent.resource);
	if (isRefused(sym)) return sym;
	const name = sym.decl.name;
	if (!name) return refused('unsupported-form', [sym.decl.header]);
	const unsafe = checkSafeText(intent.name, [name]);
	if (unsafe) return unsafe;
	const file = fileOf(ctx, name);
	if (isRefused(file)) return file;
	const written = parseString(file.text.sliceString(name.from, name.to));
	if (!written.ok)
		return checkTextOnly(ctx, name.file, name) ?? refused('unsupported-form', [name]);
	if (written.value === intent.name) return noop('already-set');
	const style = written.style === 'cut' ? 'double' : written.style;
	const printed = printStringPreferring(intent.name, style);
	if (!printed.ok || printed.value.startsWith('-8<-')) return refused('unsafe-text', [name]);
	return [replaceSpan(file, name, printed.value)];
}

export const RESOURCE_TREE_HANDLERS: {
	readonly addResource: IntentHandler<'addResource'>;
	readonly deleteResource: IntentHandler<'deleteResource'>;
	readonly moveResource: IntentHandler<'moveResource'>;
	readonly renameResource: IntentHandler<'renameResource'>;
} = {
	addResource: { plan: planAddResource },
	deleteResource: { plan: planDeleteResource },
	moveResource: { plan: planMoveResource },
	renameResource: { plan: planRenameResource, sameInEveryVisit: true },
};
