// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Re-checking values after a project-level change (phase-1.md 7.1 `invalid-value` for
 * `setProjectHeader`, `setProjectAttr`, `removeProjectAttr` and the project's `setWorkingHours`).
 *
 * A project setting changes how TaskJuggler reads the values after it: the header interval is
 * the frame `start`, `end`, `minstart` and `maxend` must lie in; `timezone` changes the instant a
 * date names and so its alignment to the timing resolution, and the cap `timingresolution` may
 * have (too_large_timing_res, read where the statement stands); `dailyworkinghours` and the
 * project working hours change how durations convert. `newValueErrors` applies the ops to a copy
 * of the snapshot, rebuilds the index there (with the same time-zone data) and compares the value
 * diagnostics (diagnostics-local.ts `valueDiagnostics`, the checks TaskJuggler makes while it
 * reads a value) before and after: an error the edit adds, at a value or setting the edit did not
 * write or at one it did, makes the intent `invalid-value` at that place (pre-edit coordinates).
 * Checks that read a setting written with a macro, or that need time-zone data the index lacks,
 * are skipped there as the diagnostics skip them ("where checkable").
 */
import type { ChangeSet } from '@codemirror/state';
import type { WorkspaceSnapshot } from '../../workspace/workspace';
import { buildIncludeGraph } from '../../workspace/includes';
import { pathLookup } from '../../workspace/paths';
import { valueDiagnostics } from '../diagnostics-local';
import { changeSetOf, updateFile, withTop, type TjpFile } from '../document';
import { buildIndex, type SourceRange } from '../index';
import { refused, type EditContext, type EditOp, type Refused } from './types';

/** Per changed file, the change set of the ops (overlapping ops are a bug and throw). */
export function changeSets(ws: WorkspaceSnapshot, ops: readonly EditOp[]): Map<string, ChangeSet> {
	const by = new Map<string, EditOp[]>();
	for (const op of ops) by.set(op.file, [...(by.get(op.file) ?? []), op]);
	const out = new Map<string, ChangeSet>();
	for (const [path, list] of by) {
		const file = ws.files.get(path);
		if (!file) continue;
		const sorted = list
			.map((op, i) => ({ op, i }))
			.sort((a, b) => a.op.from - b.op.from || a.op.to - b.op.to || a.i - b.i)
			.map((x) => ({ from: x.op.from, to: x.op.to, insert: x.op.insert }));
		out.set(path, changeSetOf(sorted, file.text.length));
	}
	return out;
}

/** The snapshot after applying change sets (files reparsed, include graph walked again). */
export function snapshotAfter(
	ws: WorkspaceSnapshot,
	sets: ReadonlyMap<string, ChangeSet>,
): WorkspaceSnapshot {
	const files = new Map<string, TjpFile>(ws.files);
	for (const [path, cs] of sets) {
		const f = files.get(path);
		if (f) files.set(path, updateFile(f, cs));
	}
	const includes = buildIncludeGraph(ws.entry, {
		lookup: pathLookup(files.keys()),
		parse: (path, top) => {
			const have = files.get(path);
			if (!have) throw new Error(`include graph asked for unknown file ${path}`);
			const f = withTop(have, top);
			if (f !== have) files.set(path, f);
			return { tree: f.tree, read: (from, to) => f.text.sliceString(from, to) };
		},
	});
	return { entry: ws.entry, version: ws.version + 1, files, includes };
}

const key = (file: string | null, from: number, to: number, id: string): string =>
	`${file ?? ''}\0${from}\0${to}\0${id}`;

/** Value errors the ops add (module comment), in pre-edit coordinates. */
export function newValueErrors(ctx: EditContext, ops: readonly EditOp[]): SourceRange[] {
	const sets = changeSets(ctx.ws, ops);
	const after = snapshotAfter(ctx.ws, sets);
	const zones = ctx.index.contextAt(ctx.ws.entry, 0).zones;
	const index = buildIndex(after, undefined, zones ? { zones } : {});
	const before = new Set<string>();
	for (const d of valueDiagnostics(ctx.ws, ctx.index)) {
		const cs = d.file === null ? undefined : sets.get(d.file);
		const from = cs ? cs.mapPos(d.from, 1) : d.from;
		const to = cs ? cs.mapPos(d.to, -1) : d.to;
		before.add(key(d.file, from, to, d.messageId));
	}
	const out: SourceRange[] = [];
	for (const d of valueDiagnostics(after, index)) {
		if (d.file === null || before.has(key(d.file, d.from, d.to, d.messageId))) continue;
		const cs = sets.get(d.file);
		const base = ctx.ws.files.get(d.file)?.text;
		const back = cs && base ? cs.invert(base) : null;
		out.push({
			file: d.file,
			from: back ? back.mapPos(d.from, -1) : d.from,
			to: back ? back.mapPos(d.to, 1) : d.to,
		});
	}
	return out;
}

/** `invalid-value` at the value errors the ops add, or null. */
export function checkValuesAfter(ctx: EditContext, ops: readonly EditOp[]): Refused | null {
	const at = newValueErrors(ctx, ops);
	return at.length > 0 ? refused('invalid-value', at) : null;
}
