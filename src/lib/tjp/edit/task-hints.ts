// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Engine hints for the edited workspace of a task tree intent (task-verify.ts). The hints the
 * index was built with are not kept, so they are read back from it: every task and resource it
 * knows gives `{ id, parent, file, header line }`, as the engine reported it. Each entry is then
 * carried through the edit by the line rules of 15.18 (workspace/run-lines.ts `lineMap`): a header
 * line that the edit leaves whole and untouched keeps its hint, at its new line number; a line the
 * edit changes, splits, joins or moves (the moved block) loses it. Ids and parents go through the
 * intent's id map, and entries of deleted tasks are dropped.
 *
 * `kept` lists the ids (old ids) whose hint survived. An id resolved only through hints whose hint
 * did not survive cannot be checked in the edited workspace (task-verify.ts leaves it out).
 */
import type { ChangeSet } from '@codemirror/state';
import { lineMap } from '../../workspace/run-lines';
import type { WorkspaceSnapshot } from '../../workspace/workspace';
import type { EngineHints, HintEntry, SymbolIndex } from '../index';
import type { TjpFile } from '../document';
import { TjLines } from '../lines';

/** TaskJuggler line starts per file version, built once (a scan of the whole text). */
const linesOf = new WeakMap<TjpFile, TjLines>();

function tjLines(file: TjpFile): TjLines {
	let l = linesOf.get(file);
	if (!l) {
		l = new TjLines(file.text);
		linesOf.set(file, l);
	}
	return l;
}

export interface MappedHints {
	readonly hints: EngineHints;
	/** Old ids (tasks and resources) whose hint survived the edit. */
	readonly kept: ReadonlySet<string>;
	/** Whether the index resolved anything through hints (otherwise `hints` is not needed). */
	readonly used: boolean;
}

interface Sym {
	readonly id: string;
	readonly parent: string | null;
	readonly idSource: 'text' | 'engine';
	readonly expandedOnly: boolean;
	readonly decl: { readonly header: { readonly file: string; readonly from: number } };
}

/** The hints of `index`, carried from `before` to `after` (module comment). */
export function mapHints(
	index: SymbolIndex,
	before: WorkspaceSnapshot,
	after: WorkspaceSnapshot,
	changes: ReadonlyMap<string, ChangeSet>,
	mapTask: (id: string) => string | null,
): MappedHints {
	const used = [...index.tasks.values(), ...index.resources.values()].some(
		(s) => s.idSource === 'engine' || s.expandedOnly,
	);
	const kept = new Set<string>();
	if (!used) return { hints: { tasks: [], resources: [] }, kept, used };
	const lines = lineMap(before, after, changes);
	const carry = (list: Iterable<Sym>, map: (id: string) => string | null): HintEntry[] => {
		const out: HintEntry[] = [];
		for (const s of list) {
			const { file, from } = s.decl.header;
			const f = before.files.get(file);
			if (!f) continue;
			const old = tjLines(f).lineOf(from);
			const line = lines.mapLine(file, old);
			const id = map(s.id);
			if (line === null || id === null) continue;
			kept.add(s.id);
			const parent = s.parent === null ? null : map(s.parent);
			const sent = lines.sentLine(file, old);
			const e: HintEntry = { id, parent, file, line };
			out.push(sent === null ? e : { ...e, text: sent });
		}
		return out;
	};
	return {
		hints: {
			tasks: carry(index.tasks.values(), mapTask),
			resources: carry(index.resources.values(), (id) => id),
		},
		kept,
		used,
	};
}
