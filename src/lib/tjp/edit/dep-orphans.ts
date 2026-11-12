// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Dependency items as the loop check and the dependency intents read them:
 *
 * - `itemNode`, `depOnEnd`: an item's node and the end of the other task it targets (`depends`
 *   defaults to the end, `precedes` to the start; the last `onend`/`onstart` in its body wins).
 * - `orphanDeps`: items written in declarations the index cannot name (an auto id
 *   `task "Item 1" { depends !!wp1 }`, a macro id without engine hints). Their owner is unknown,
 *   but it lies inside the innermost named task around it (`within`), at a known depth below it
 *   (the unnamed declarations around the statement), which is enough to resolve relative
 *   references as rule_taskDepId does and to place the edges in the loop check: TaskJuggler
 *   schedules these tasks like any other. Unprefixed `depends` on a container are inherited by
 *   such children too (deps.ts uses this for task_depend_multi).
 */
import type { SyntaxNode } from '@lezer/common';
import type { WorkspaceSnapshot } from '../../workspace/workspace';
import type { DependencySite, SourceRange, SymbolIndex, TaskId } from '../index';
import { statementsIn } from '../tree';
import { parseTaskRef, resolveTaskRef } from '../values';
import type { Span, WorkspacePath } from './types';

/** The item node (`DepItem`, `AllocItem`) with exactly this range. */
export function itemNode(
	ws: WorkspaceSnapshot,
	file: WorkspacePath,
	item: Span,
	name = 'DepItem',
): SyntaxNode | null {
	const f = ws.files.get(file);
	for (let n: SyntaxNode | null = f?.tree.resolveInner(item.from, 1) ?? null; n; n = n.parent) {
		if (n.from < item.from) break;
		if (n.name === name && n.to === item.to) return n;
	}
	return null;
}

/** Whether a dependency item targets the other task's end (module comment). */
export function depOnEnd(ws: WorkspaceSnapshot, d: DependencySite): boolean {
	let onEnd = d.form === 'depends';
	const body = itemNode(ws, d.item.file, d.item)?.getChild('Body');
	if (!body) return onEnd;
	for (const s of statementsIn(body)) {
		if (s.name === 'OnendStatement') onEnd = true;
		else if (s.name === 'OnstartStatement') onEnd = false;
	}
	return onEnd;
}

/** A dependency item of a declaration the index cannot name. */
export interface OrphanDep {
	/** A stable id for the unnamed owner (its declaration's file and offset). */
	readonly owner: string;
	/** The innermost named task around the owner; null at the top level. */
	readonly within: TaskId | null;
	readonly form: 'depends' | 'precedes';
	readonly target: TaskId;
	readonly onEnd: boolean;
	readonly scenario: string | null;
	readonly site: DependencySite;
}

const inside = (inner: SourceRange, outer: SourceRange): boolean =>
	inner.file === outer.file && outer.from <= inner.from && inner.to <= outer.to;

/** The orphan items of the index (module comment), with their targets resolved. */
export function orphanDeps(ws: WorkspaceSnapshot, index: SymbolIndex): OrphanDep[] {
	const out: OrphanDep[] = [];
	const unnamed = index.unresolved.filter((u) => u.kind === 'task').map((u) => u.decl.block);
	for (const d of index.dependencies) {
		if ((d.form === 'depends' ? d.succ : d.pred) !== null) continue;
		const around = unnamed.filter((b) => inside(d.statement, b));
		const owner = around.reduce<SourceRange | null>(
			(best, b) => (best === null || b.to - b.from < best.to - best.from ? b : best),
			null,
		);
		if (!owner) continue;
		let within: TaskId | null = null;
		let size = Infinity;
		for (const t of index.tasks.values()) {
			for (const b of [t.decl.block, ...t.supplements.map((s) => s.block)]) {
				if (inside(owner, b) && b.to - b.from < size) {
					within = t.id;
					size = b.to - b.from;
				}
			}
		}
		const w = within === null ? null : index.tasks.get(within);
		const blocks = w ? [w.decl.block, ...w.supplements.map((s) => s.block)] : null;
		const depth = around.filter((b) => blocks === null || blocks.some((x) => inside(b, x))).length;
		const target = resolveOrphan(d, within, depth);
		if (target === null || !index.tasks.has(target)) continue;
		out.push({
			owner: `${owner.file}\0${owner.from}`,
			within,
			form: d.form,
			target,
			onEnd: depOnEnd(ws, d),
			scenario: d.scenario,
			site: d,
		});
	}
	return out;
}

/** The target of an orphan's reference, `depth` unnamed levels below `within`. */
function resolveOrphan(d: DependencySite, within: TaskId | null, depth: number): TaskId | null {
	const p = parseTaskRef(d.written.trim());
	if (!p.ok) return null;
	const { up, path } = p.value;
	if (up === 0) return path;
	if (up < depth) return null;
	if (up === depth) return within === null ? path : `${within}.${path}`;
	if (within === null) return null;
	const r = resolveTaskRef({ up: up - depth, path }, within);
	return r.ok ? r.value : null;
}
