// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Engine hints (6.4, 5.4 X4 and X5): the task and resource ids the last schedule result gave,
 * with the file and line TaskJuggler recorded for each (the line of the `task`/`resource`
 * keyword, rule_taskHeader at TjpSyntaxRules.rb:6127; for text injected by a macro, the line of
 * the call). Lines are mapped from the text that was scheduled to the current text by the caller.
 *
 * Matching (link.ts) is by (file, header line). The candidates on a line are filtered by the
 * parent the text gives (when it is known), by the literal local id (when there is one) and by
 * ids already indexed; a declaration takes a hint only when exactly one candidate is left, so a
 * line with several candidates stays unresolved.
 */
import type { ScheduleResult, WorkspacePath } from '../../../engine/protocol';
import type { EngineHints, HintEntry, PropertyKind } from './types';

export function hintsFromResult(
	r: ScheduleResult,
	mapLine: (file: WorkspacePath, line: number) => number | null,
): EngineHints {
	const map = (
		list: ReadonlyArray<{
			id: string;
			parent: string | null;
			source: ScheduleResult['tasks'][number]['source'];
		}>,
	): HintEntry[] => {
		const out: HintEntry[] = [];
		for (const p of list) {
			if (!p.source || p.source.line === null) continue;
			const line = mapLine(p.source.file, p.source.line);
			if (line === null) continue;
			out.push({ id: p.id, parent: p.parent, file: p.source.file, line });
		}
		return out;
	};
	return { tasks: map(r.tasks), resources: map(r.resources) };
}

export const NO_HINTS: EngineHints = { tasks: [], resources: [] };

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

	/**
	 * The candidates for a declaration on (file, line). `parent` undefined means the parent is
	 * unknown; `localId` null means the id is not literal.
	 */
	candidates(
		kind: PropertyKind,
		file: WorkspacePath,
		line: number,
		parent: string | null | undefined,
		localId: string | null,
		taken: (id: string) => boolean,
	): HintEntry[] {
		const list = this.byLine.get(HintTable.key(kind, file, line)) ?? [];
		return list.filter((e) => {
			if (taken(e.id)) return false;
			if (parent !== undefined && e.parent !== parent) return false;
			if (localId !== null) {
				const local = kind === 'task' ? e.id.slice(e.id.lastIndexOf('.') + 1) : e.id;
				if (local !== localId) return false;
			}
			return true;
		});
	}
}
