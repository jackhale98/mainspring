// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Building `TjpEdit`s (phase-1.md 6.5, 14.5). An intent is a small handler that reads the index
 * and returns `EditOp`s per file through the layout helpers (layout.ts), or a refusal or no-op;
 * `applyIntent` runs it, then the refusal pipeline (refuse.ts), then `buildEdit`:
 *
 * - ops are grouped per file and sorted (stable, so insertions at one point keep their order);
 *   overlapping ops, or an op outside its declared target, are bugs in the handler and throw;
 * - each changed file gets one CodeMirror `ChangeSet` from its base text (`\n` as the only line
 *   separator, document.ts), its `inverse` (`ChangeSet.invert` against the base text, so applying
 *   it after the edit restores the base byte for byte), its targets and its base version;
 * - each changed file is reparsed (incrementally); an edit that adds error nodes is refused with
 *   `syntax-error` at the new errors, mapped back to the base text;
 * - `select` is mapped to post-edit coordinates.
 *
 * Every file's ChangeSet shares one edit id; `Workspace.apply` dispatches one transaction per
 * file with `tjpEditId.of(id)` and `userEvent` `input.tjp.<type>`, all or nothing ('stale' when a
 * base version moved). `applyEdit` does that and records the file versions the apply produced;
 * `undoEdit` builds the inverse edit only while those versions are still current (Phase 2 groups
 * the per-file transactions into one undo step).
 *
 * A handler declares whether its change means the same in every include visit of a shared file
 * (`sameInEveryVisit`, 15.15): only then can `EditOptions.confirmShared` let it through.
 *
 * `formatFile(ws, file)` wraps format.ts (7.3); it skips the text-only checks (format re-indents
 * opaque and auto-id blocks on purpose, 15.13) and refuses only `syntax-error`.
 */
import type { ChangeSet } from '@codemirror/state';
import { tjpEditId, type Workspace, type WorkspaceSnapshot } from '../../workspace/workspace';
import { changeSetOf, updateFile } from '../document';
import { formatFile as formatChanges, type FormatOptions } from '../format';
import type { SymbolIndex } from '../index';
import { syntaxIssues } from '../tree';
import { ALLOCATION_HANDLERS } from './allocation';
import { WORKING_HOURS_HANDLERS } from './calendar';
import { LEAVE_HANDLERS } from './calendar-leaves';
import { DEPENDENCY_HANDLERS } from './deps';
import { PROJECT_HANDLERS } from './project';
import { RESOURCE_ATTR_HANDLERS } from './resource-attrs';
import { RESOURCE_TREE_HANDLERS } from './resource-tree';
import { checkOps, opTarget } from './refuse';
import {
	isNoop,
	isRefused,
	noop,
	refused,
	type EditContext,
	type EditIntent,
	type EditOp,
	type EditOptions,
	type EditResult,
	type IntentOf,
	type IntentPlan,
	type IntentType,
	type SourceRange,
	type TjpEdit,
	type WorkspacePath,
} from './types';

export interface IntentHandler<K extends IntentType> {
	/** The ops of the intent, built with the layout helpers, or a refusal or no-op. */
	readonly plan: (ctx: EditContext, intent: IntentOf<K>) => IntentPlan;
	/**
	 * True when the text change means the same in every include visit of a file read several times
	 * (a value rewrite, a name string), so a confirmed `shared-declaration` may go through. Structural
	 * changes (blocks, references, list lines, new ids) leave it false: they are always refused there.
	 */
	readonly sameInEveryVisit?: boolean | ((intent: IntentOf<K>) => boolean);
}

/** A handler with its intent type erased, as `applyIntent` calls it. */
interface AnyHandler {
	readonly plan: (ctx: EditContext, intent: EditIntent) => IntentPlan;
	readonly sameInEveryVisit?: boolean | ((intent: EditIntent) => boolean);
}
export type IntentHandlers = { readonly [K in Exclude<IntentType, 'format'>]?: IntentHandler<K> };

/** One handler per intent type; T11a to T11d add theirs. `format` goes through `formatFile`. */
export const HANDLERS: IntentHandlers = {
	...DEPENDENCY_HANDLERS,
	...ALLOCATION_HANDLERS,
	...RESOURCE_TREE_HANDLERS,
	...RESOURCE_ATTR_HANDLERS,
	...PROJECT_HANDLERS,
	...WORKING_HOURS_HANDLERS,
	...LEAVE_HANDLERS,
};

let seq = 0;
const session = Math.random().toString(36).slice(2, 8);

/** A fresh edit id, unique within this page load. */
export function newEditId(): string {
	seq++;
	return `tjp-${session}-${seq.toString(36)}`;
}

/** Runs an intent: its handler, the refusal pipeline, then `buildEdit`. */
export function applyIntent(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	intent: EditIntent,
	opts: EditOptions = {},
	handlers: IntentHandlers = HANDLERS,
): EditResult {
	if (intent.type === 'format') return formatFile(ws, intent.file, opts);
	const handler = handlers[intent.type] as AnyHandler | undefined;
	if (!handler) throw new Error(`no edit handler for intent ${intent.type}`);
	const ctx: EditContext = { ws, index, opts };
	const same = handler.sameInEveryVisit;
	const sameEverywhere = typeof same === 'function' ? same(intent) : (same ?? false);
	return finishPlan(ctx, intent, handler.plan(ctx, intent), sameEverywhere);
}

/**
 * The refusal pipeline and `buildEdit` over a handler's plan; `sameInEveryVisit` as the handler
 * declares it.
 */
export function finishPlan(
	ctx: EditContext,
	intent: EditIntent,
	plan: IntentPlan,
	sameInEveryVisit = false,
): EditResult {
	if (isRefused(plan) || isNoop(plan)) return plan;
	const r = checkOps(ctx, plan, sameInEveryVisit);
	return r ?? buildEdit(ctx.ws, intent, plan, ctx.opts);
}

interface BuildOptions extends EditOptions {
	/** Reparse changed files and refuse new error nodes (default true). */
	readonly checkParse?: boolean;
}

const sourceRange = (file: WorkspacePath, from: number, to: number): SourceRange => ({
	file,
	from,
	to,
});

/**
 * The TjpEdit for already-checked ops (module comment), or `syntax-error` when the result would
 * have new error nodes, or `already-set` when the ops change nothing.
 */
export function buildEdit(
	ws: WorkspaceSnapshot,
	intent: EditIntent,
	ops: readonly EditOp[],
	opts: BuildOptions = {},
): EditResult {
	const byFile = new Map<WorkspacePath, EditOp[]>();
	for (const op of ops) {
		const list = byFile.get(op.file);
		if (list) list.push(op);
		else byFile.set(op.file, [op]);
	}
	const base: Record<WorkspacePath, number> = {};
	const changes: Record<WorkspacePath, ChangeSet> = {};
	const inverse: Record<WorkspacePath, ChangeSet> = {};
	const targets: Record<WorkspacePath, SourceRange[]> = {};
	let select: SourceRange | null = null;
	for (const [path, list] of byFile) {
		const file = ws.files.get(path);
		if (!file) return refused('unknown-target');
		const text = file.text;
		const sorted = list
			.filter((op) => op.insert !== text.sliceString(op.from, op.to))
			.map((op, i) => ({ op, i }))
			.sort((a, b) => a.op.from - b.op.from || a.op.to - b.op.to || a.i - b.i)
			.map((x) => x.op);
		const post = new Map<EditOp, number>();
		let delta = 0;
		let prev: EditOp | null = null;
		for (const op of sorted) {
			if (prev && prev.to > op.from) {
				throw new Error(`${intent.type}: overlapping changes in ${path} at ${op.from}`);
			}
			const t = opTarget(op);
			if (op.from < t.from || op.to > t.to || op.from > op.to) {
				throw new Error(`${intent.type}: change ${op.from}-${op.to} outside its target`);
			}
			post.set(op, op.from + delta);
			delta += op.insert.length - (op.to - op.from);
			prev = op;
		}
		if (!select) {
			const first = list.find((op) => op.select && post.has(op));
			const at = first && post.get(first);
			if (first?.select && at !== undefined) {
				select = sourceRange(path, at + first.select.from, at + first.select.to);
			}
		}
		const cs = changeSetOf(
			sorted.map((o) => ({ from: o.from, to: o.to, insert: o.insert })),
			file.text.length,
		);
		if (cs.empty) continue;
		if (opts.checkParse ?? true) {
			const before = syntaxIssues(file.tree, file.text).length;
			const after = updateFile(file, cs);
			const errors = syntaxIssues(after.tree, after.text);
			if (errors.length > before) {
				const back = cs.invert(file.text);
				const at = errors.map((e) =>
					sourceRange(path, back.mapPos(e.from, -1), back.mapPos(e.to, 1)),
				);
				return refused('syntax-error', at);
			}
		}
		base[path] = file.version;
		changes[path] = cs;
		inverse[path] = cs.invert(file.text);
		const seen = new Set<string>();
		targets[path] = sorted
			.map((op) => opTarget(op))
			.filter((t) => {
				const k = `${t.from}:${t.to}`;
				return seen.has(k) ? false : (seen.add(k), true);
			})
			.map((t) => sourceRange(path, t.from, t.to));
	}
	if (Object.keys(changes).length === 0) return noop('already-set');
	const edit: TjpEdit = {
		id: opts.id ?? newEditId(),
		intent,
		base,
		changes,
		inverse,
		targets,
		select,
	};
	return { status: 'edit', edit };
}

/** Format on demand (7.3) as an edit; refuses `syntax-error` only, noop when already formatted. */
export function formatFile(
	ws: WorkspaceSnapshot,
	file: WorkspacePath,
	opts: EditOptions & FormatOptions = {},
): EditResult {
	const f = ws.files.get(file);
	if (!f) return refused('unknown-target');
	const r = formatChanges(f, opts);
	if (r.status === 'refused') return refused('syntax-error', r.at);
	if (r.changes.length === 0) return noop('already-set');
	const ops: EditOp[] = r.changes.map((c) => ({
		file,
		from: c.from,
		to: c.to,
		insert: c.insert,
		element: { from: c.from, to: c.to },
	}));
	// format.ts has reparsed the result already.
	return buildEdit(ws, { type: 'format', file }, ops, { ...opts, checkParse: false });
}

/** An edit `applyEdit` applied, with the version of each changed file right after it. */
export interface AppliedEdit {
	readonly edit: TjpEdit;
	readonly versions: Readonly<Record<WorkspacePath, number>>;
}

/**
 * `Workspace.apply`, recording the file versions the apply produced (from the snapshot the
 * workspace announces with this edit's transactions, so listeners that edit in turn do not count).
 */
export function applyEdit(workspace: Workspace, edit: TjpEdit): AppliedEdit | 'stale' {
	let versions: Record<WorkspacePath, number> | null = null;
	const off = workspace.subscribe((snap, _origin, info) => {
		if (versions || !info.transactions.some((t) => t.annotation(tjpEditId) === edit.id)) return;
		const v: Record<WorkspacePath, number> = {};
		for (const path of Object.keys(edit.changes)) v[path] = snap.files.get(path)?.version ?? -1;
		versions = v;
	});
	let r: 'applied' | 'stale';
	try {
		r = workspace.apply(edit);
	} finally {
		off();
	}
	if (r === 'stale') return 'stale';
	return { edit, versions: versions ?? { ...edit.base } };
}

/**
 * The edit that undoes an applied edit on `now`: its changes are `edit.inverse`, its targets their
 * ranges. Null unless every changed file still has exactly the version the apply produced (any
 * later change, even one of the same length, makes the inverse wrong).
 */
export function undoEdit(
	applied: AppliedEdit,
	now: WorkspaceSnapshot,
	opts: EditOptions = {},
): TjpEdit | null {
	const { edit, versions } = applied;
	const base: Record<WorkspacePath, number> = {};
	const targets: Record<WorkspacePath, SourceRange[]> = {};
	for (const [path, inv] of Object.entries(edit.inverse)) {
		const f = now.files.get(path);
		const v = versions[path];
		const b = edit.base[path];
		if (!f || v === undefined || b === undefined || v <= b) return null;
		if (f.version !== v || f.text.length !== inv.length) return null;
		base[path] = f.version;
		const list: SourceRange[] = [];
		inv.iterChangedRanges((fromA, toA) => list.push(sourceRange(path, fromA, toA)));
		targets[path] = list;
	}
	return {
		id: opts.id ?? newEditId(),
		intent: edit.intent,
		base,
		changes: edit.inverse,
		inverse: edit.changes,
		targets,
		select: null,
	};
}
