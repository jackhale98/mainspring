// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Engine hints (6.4, 5.4 X4 and X5): the task and resource ids the last schedule result gave,
 * with the file and line TaskJuggler recorded for each (the line of the `task`/`resource`
 * keyword, rule_taskHeader at TjpSyntaxRules.rb:6127; for text injected by a macro, the line of
 * the call).
 *
 * `hintsFromResult(r, mapLine, sentLine)`:
 * - `mapLine(file, line)` maps a line of the text that was scheduled (`r.revision`) to the
 *   current text, and must return null for a line touched since then (changed, split or
 *   deleted): such a hint describes text that no longer exists.
 * - `sentLine(file, line)` gives that line's text as it was scheduled. It becomes the hint's
 *   fingerprint: a hint is used only while the current line reads the same, so a stale hint on
 *   a rewritten header (`task ${x}` became `task ${y}`) never names the new declaration.
 *
 * Matching (link.ts) is by (file, header line). The candidates on a line are filtered by the
 * fingerprint, the parent the text gives (when it is known), the literal local id (when there
 * is one), the literal ids of the line's other declarations and ids already indexed; a
 * declaration takes a hint only when exactly one candidate is left, so a line with several
 * candidates stays unresolved.
 */
import type { Text } from '@codemirror/state';
import type { ScheduleResult, WorkspacePath } from '../../../engine/protocol';
import type { EngineHints, HintEntry, PropertyKind } from './types';

type Source = ScheduleResult['tasks'][number]['source'];

export function hintsFromResult(
	r: ScheduleResult,
	mapLine: (file: WorkspacePath, line: number) => number | null,
	sentLine?: (file: WorkspacePath, line: number) => string | null,
): EngineHints {
	const map = (
		list: ReadonlyArray<{ id: string; parent: string | null; source: Source }>,
	): HintEntry[] => {
		const out: HintEntry[] = [];
		for (const p of list) {
			if (!p.source || p.source.line === null) continue;
			const line = mapLine(p.source.file, p.source.line);
			if (line === null) continue;
			const text = sentLine?.(p.source.file, p.source.line) ?? null;
			const e: HintEntry = { id: p.id, parent: p.parent, file: p.source.file, line };
			out.push(text === null ? e : { ...e, text });
		}
		return out;
	};
	return { tasks: map(r.tasks), resources: map(r.resources) };
}

export const NO_HINTS: EngineHints = { tasks: [], resources: [] };

/** Whether a hint still describes `doc`: its line exists and reads as it was scheduled. */
export function fresh(e: HintEntry, doc: Text): boolean {
	if (e.line < 1 || e.line > doc.lines) return false;
	return e.text === undefined || doc.line(e.line).text === e.text;
}

const localOf = (kind: PropertyKind, id: string): string =>
	kind === 'task' ? id.slice(id.lastIndexOf('.') + 1) : id;

/** Hint entries by kind, file and line. */
export class HintTable {
	private readonly byLine = new Map<string, HintEntry[]>();

	constructor(readonly hints: EngineHints) {
		const add = (kind: PropertyKind, e: HintEntry): void => {
			const k = HintTable.key(kind, e.file, e.line);
			const list = this.byLine.get(k);
			if (list) list.push(e);
			else this.byLine.set(k, [e]);
		};
		for (const e of hints.tasks) add('task', e);
		for (const e of hints.resources) add('resource', e);
	}

	static key(kind: PropertyKind, file: WorkspacePath, line: number): string {
		return `${kind}\0${file}\0${line}`;
	}

	get empty(): boolean {
		return this.byLine.size === 0;
	}

	/** The fresh hints on (file, line) of a kind. */
	onLine(kind: PropertyKind, file: WorkspacePath, line: number, doc: Text): HintEntry[] {
		return (this.byLine.get(HintTable.key(kind, file, line)) ?? []).filter((e) => fresh(e, doc));
	}

	/**
	 * The candidates for a declaration on (file, line). `parent` undefined means the parent is
	 * unknown; `localId` null means the id is not literal, and then `others` (the literal local
	 * ids of the line's other declarations) are excluded.
	 */
	candidates(
		kind: PropertyKind,
		file: WorkspacePath,
		line: number,
		doc: Text,
		parent: string | null | undefined,
		localId: string | null,
		others: readonly string[],
		taken: (id: string) => boolean,
	): HintEntry[] {
		return this.onLine(kind, file, line, doc).filter((e) => {
			if (taken(e.id)) return false;
			if (parent !== undefined && e.parent !== parent) return false;
			const local = localOf(kind, e.id);
			if (localId !== null) return local === localId;
			return !others.includes(local);
		});
	}
}
