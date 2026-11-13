// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Resource tree intents (phase-1.md 7.1 `addResource`, `deleteResource`, `moveResource`,
 * `renameResource`: "as the task forms"; 14.9). Resource ids are global (`resourceprefix` only
 * sets the parent of resources declared in an included file), so moving a resource changes no
 * reference. Placement and re-indenting are in blocks.ts.
 *
 * - `addResource` inserts `resource <id> "<name>"`, with a body for `attrs` (7.2 resource order),
 *   at the child place (blocks.ts); a first root goes before the first top-level task (before the
 *   include statement when that task is read under a `resourceprefix`), else at the end of the
 *   entry file. The id is the given one (`id-collision` when any resource has it,
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
 *   different `resourceprefix` (the ids in the block would read differently; an unknown prefix
 *   equals none) `unsupported-form`; a use read before its declaration after the move, either
 *   way in reading order, `unfixable-reference` (resource-order.ts).
 * - A new or moved resource inherits its new parent chain's `managers`: an added edge that leads
 *   to a loop of managers is `cycle` (manager-loops.ts).
 * - A new parent must be able to take the child (resource-checks.ts: manager_is_group,
 *   booking_group, leaf_resource_id_expected, container_attribute, shift_assignment_overlap,
 *   manager_is_self):
 *   `conflicting-attribute`.
 * - `renameResource` rewrites the name string only, in its quote style (a cut-here name becomes
 *   double-quoted), escaping that quote; `unsafe-text` as above; noop for the same name.
 *
 * Only `renameResource` means the same in every include visit of a shared file (15.16).
 */
import type { TjpFile } from '../document';
import type { ResourceSymbol, SourceRange } from '../index';
import { isId, parseString, printString, printStringPreferring, slugId } from '../values';
import type { IntentHandler } from './apply';
import { childPlace, insertBlock, movedText, targetIndent } from './blocks';
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
import { managerLoop } from './manager-loops';
import { attrStatements, managersIn } from './resource-attrs';
import { checkNewParent, insideAny, symbols } from './resource-checks';
import { checkMoveOrder } from './resource-order';
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

/**
 * Where a first root resource goes: before the first top-level task, else at the end of the
 * entry. A task read in a file included with a `resourceprefix` (known or not) would make the
 * new resource a child of the prefix, so the place moves up to the include statement.
 */
function firstRoot(ctx: EditContext): { file: TjpFile; place: Placement } | Refused {
	const { index } = ctx;
	const task = index.taskRoots.map((id) => index.tasks.get(id)).find((t) => t && !t.parent);
	let block: SourceRange | null = task?.decl.block ?? null;
	for (let v = task ? index.visits[task.visit] : undefined; v && block;) {
		if (v.resourcePrefix.kind === 'none') break;
		block = v.site;
		v = v.parent === null ? undefined : index.visits[v.parent];
	}
	const file = ctx.ws.files.get(block?.file ?? ctx.ws.entry);
	if (!file) return refused('unknown-target');
	return { file, place: block ? { before: block } : 'end' };
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
	const group = checkNewParent(ctx, parent, []);
	if (group) return group;
	const where = childPlace(ctx, parent, siblingsOf(ctx, parent), intent.index, () =>
		firstRoot(ctx),
	);
	if (isRefused(where)) return where;
	const body = attrStatements(ctx, id, intent.attrs ?? [], where.file.path, at);
	if (isRefused(body)) return body;
	const own = managersIn(intent.attrs ?? []);
	const loop = managerLoop(ctx, { added: { id, parent: parent?.id ?? null, own } });
	if (loop) return loop;
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
		list.push({ stmt: r.at, leading: r.leading, block: true });
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

/** The written resource prefix of a file's first visit; an unknown one equals no other. */
function prefixKey(ctx: EditContext, file: string): string {
	const p = ctx.index.visits.find((v) => v.file === file)?.resourcePrefix ?? { kind: 'none' };
	return p.kind === 'id' ? `id:${p.id}` : p.kind === 'none' ? 'none' : `unknown:${file}`;
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
	const group = checkNewParent(ctx, parent, ids);
	if (group) return group;
	const loop = managerLoop(ctx, { parent: new Map([[sym.id, parent?.id ?? null]]) });
	if (loop) return loop;
	const where = childPlace(ctx, parent, siblings, i, () => firstRoot(ctx));
	if (isRefused(where)) return where;
	const src = fileOf(ctx, sym.decl.block);
	if (isRefused(src)) return src;
	if (src.path !== where.file.path && prefixKey(ctx, src.path) !== prefixKey(ctx, where.file.path))
		return refused('unsupported-form', [sym.decl.header]);
	const order = checkMoveOrder(ctx, sym, ids, where);
	if (order) return order;
	const indent = targetIndent(where.file, where.owner);
	if (indent === null) return refused('unknown-target', where.owner ? [where.owner] : []);
	const eol = lineBreakNear(fileText(where.file), where.owner?.from ?? 0);
	const moved = movedText(src, sym.decl.block, indent, indentUnit(where.file), eol);
	const header = sym.decl.header;
	const select = { from: moved.header, to: moved.header + (header.to - header.from) };
	const ins = insertBlock(where, moved.text, select);
	if (isRefused(ins)) return ins;
	const cut = removeStatements(src, [
		{ stmt: sym.decl.block, leading: sym.decl.leadingComments, block: true },
	]);
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
