// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Reading-order checks for `moveResource` (resource-tree.ts; phase-1.md 15.22). TaskJuggler
 * resolves some ids while it parses, so moving a block in reading order can leave a use of the
 * subtree before its declaration, or a use in the block before what it names. Each is
 * `unfixable-reference` at the use:
 *
 * - Moved later: uses of the subtree outside the block read before the new place: allocations
 *   (rule_allocationHeader), `supplement resource` blocks ("not a defined resource"), includes
 *   whose `resourceprefix` names it, and mentions in opaque statements (a task's `booking` or
 *   `limits { resources … }`). A mention in a macro body counts wherever the body is (a call may
 *   be anywhere); an opaque mention read after the new place (a report at the end) is fine.
 * - Moved earlier: uses in the block of something declared between the new and the old place:
 *   every `booking` (conservative: its task ids are read while parsing), opaque mentions of tasks
 *   and resources declared there, flags declared there, `shifts` when a `shift` statement lies
 *   there (shift declarations are not indexed), and calls of macros defined there.
 */
import { compareParseOrder, type ParsePosition } from '../../workspace/include-order';
import { mentionPattern, type ResourceSymbol, type SourceRange } from '../index';
import type { ChildPlace } from './blocks';
import { fileText } from './layout';
import { insideAny, symbols } from './resource-checks';
import { refused, type EditContext, type Refused } from './types';

/** Where a child place is read, as a point. */
export function placePosition(where: ChildPlace): ParsePosition {
	const p = where.place;
	const file = where.file.path;
	if (p === 'start') return { file, from: where.owner?.from ?? 0 };
	if (typeof p === 'object' && 'after' in p) return { file, from: p.after.to };
	if (typeof p === 'object' && 'before' in p) return { file, from: p.before.from };
	return { file, from: where.owner?.to ?? fileText(where.file).length };
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function movedLater(
	ctx: EditContext,
	sym: ResourceSymbol,
	ids: ReadonlySet<string>,
	pos: ParsePosition,
): Refused | null {
	const { index } = ctx;
	const before = (r: SourceRange): boolean =>
		compareParseOrder(ctx.ws.includes, r, pos, 'first') < 0;
	const at: SourceRange[] = [];
	for (const a of index.allocations)
		if (a.resource !== null && ids.has(a.resource) && before(a.item)) at.push(a.item);
	for (const r of index.references) {
		if (r.kind !== 'resource' || r.target === null || !ids.has(r.target)) continue;
		if (r.via === 'resourceprefix' && before(r.at)) at.push(r.at);
	}
	for (const s of symbols(ctx, [...ids])) {
		for (const sup of s.supplements) if (before(sup.block)) at.push(sup.header);
		for (const m of index.mentions('resource', s.id))
			if (m.reason !== 'opaque' || before(m.at)) at.push(m.at);
	}
	const outside = at.filter((r) => !insideAny(r, [sym.decl.block]));
	return outside.length > 0 ? refused('unfixable-reference', outside) : null;
}

function movedEarlier(
	ctx: EditContext,
	sym: ResourceSymbol,
	ids: readonly string[],
	pos: ParsePosition,
	old: ParsePosition,
): Refused | null {
	const { index } = ctx;
	const block = sym.decl.block;
	const text = ctx.ws.files.get(block.file)?.text;
	if (!text) return refused('unknown-target', [block]);
	const order = (a: ParsePosition, b: ParsePosition): number =>
		compareParseOrder(ctx.ws.includes, a, b, 'first');
	const between = (r: SourceRange): boolean => order(pos, r) < 0 && order(r, old) < 0;
	const inBlock = (r: SourceRange): boolean => insideAny(r, [block]);
	const attrs = symbols(ctx, ids)
		.flatMap((s) => s.attrs)
		.filter((a) => inBlock(a.statement));
	const at = attrs.filter((a) => a.keyword === 'booking').map((a) => a.statement);
	const opaque = index.textOnly(block.file).filter((t) => t.reason === 'opaque' && inBlock(t.at));
	const named = (kind: 'task' | 'resource', id: string): void => {
		const re = mentionPattern(kind, id);
		for (const t of opaque) {
			re.lastIndex = 0;
			const m = re.exec(text.sliceString(t.at.from, t.at.to));
			if (m)
				at.push({
					file: block.file,
					from: t.at.from + m.index,
					to: t.at.from + m.index + m[0].length,
				});
		}
	};
	if (opaque.length > 0) {
		for (const t of index.tasks.values()) if (between(t.decl.block)) named('task', t.id);
		for (const r of index.resources.values()) if (between(r.decl.block)) named('resource', r.id);
	}
	for (const r of index.references) {
		if (r.kind !== 'flag' || !inBlock(r.at)) continue;
		const decl = index.flags.get(r.target ?? r.written);
		if (decl && between(decl)) at.push(r.at);
	}
	const shifts = attrs.filter((a) => a.keyword === 'shifts' || a.keyword === 'shift');
	if (shifts.length > 0 && shiftBetween(ctx, between)) at.push(...shifts.map((a) => a.statement));
	const body = text.sliceString(block.from, block.to);
	for (const [name, defs] of index.macros) {
		if (!defs.some((d) => between(d.statement))) continue;
		const m = new RegExp(`\\$[{(]\\s*${escape(name)}(?![\\w-])`).exec(body);
		if (m)
			at.push({
				file: block.file,
				from: block.from + m.index,
				to: block.from + m.index + m[0].length,
			});
	}
	return at.length > 0 ? refused('unfixable-reference', at) : null;
}

/** Whether a `shift` statement (a declaration, or the deprecated assignment) lies between. */
function shiftBetween(ctx: EditContext, between: (r: SourceRange) => boolean): boolean {
	for (const [path, file] of ctx.ws.files) {
		for (const t of ctx.index.textOnly(path)) {
			if (t.reason !== 'opaque' || !between(t.at)) continue;
			if (/^shift\s/.test(file.text.sliceString(t.at.from, Math.min(t.at.to, t.at.from + 6))))
				return true;
		}
	}
	return false;
}

/** The reading-order refusal for moving `sym` (with `ids`, its subtree) to `where`, or null. */
export function checkMoveOrder(
	ctx: EditContext,
	sym: ResourceSymbol,
	ids: readonly string[],
	where: ChildPlace,
): Refused | null {
	const pos = placePosition(where);
	const old = { file: sym.decl.block.file, from: sym.decl.block.from };
	const c = compareParseOrder(ctx.ws.includes, pos, old, 'first');
	if (c > 0) return movedLater(ctx, sym, new Set(ids), pos);
	if (c < 0) return movedEarlier(ctx, sym, ids, pos, old);
	return null;
}
