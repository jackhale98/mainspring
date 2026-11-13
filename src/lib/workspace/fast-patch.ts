// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The main thread's half of the engine's fast path (phase-2.md section 12 and 6.12, ADR-0010):
 * which statements a fast patch may rewrite, and the `FastEdit`s of a change to them.
 *
 * A site is a task's own `effort`, `length`, `duration`, `start`, `end`, `priority` or
 * `complete` statement for the top scenario, alone on its line, when:
 * - the task is not text-only, not built by a macro, has no statement-level macro call in its
 *   bodies, and its declaration text gives no other task in another include visit (a file
 *   included twice, say with two `taskprefix`es: one line, two tasks);
 * - it is the task's only statement of that family (`effort`, `length`, `duration` and
 *   `milestone` are one family; `period` sets `start` and `end`, so it joins both of theirs), in
 *   any scenario and any supplement;
 * - for `priority`, the task is a leaf: children copy it when they are created;
 * - the value has no macro call.
 *
 * `fastEditsOf` turns a change (an intent's edit, or an undo or redo of one) into edits when
 * every changed range lies inside one site's line, the line count stays and the new line is
 * still a lone statement of that keyword with a strict value. The bridge checks all of it again
 * against its own parse (engine/bridge/fast_path.rb) and runs in full when it cannot vouch for a
 * patch, so this is the cheap first filter, never the safety net.
 */
import type { ChangeSet, Text } from '@codemirror/state';
import type { FastAttr, FastEdit, WorkspacePath } from '../../engine/protocol';
import type { SymbolIndex, TaskSymbol } from '../tjp/index';
import type { WorkspaceSnapshot } from './workspace';

export const FAST_ATTRS: readonly FastAttr[] = [
	'effort',
	'length',
	'duration',
	'start',
	'end',
	'priority',
	'complete',
];

export interface FastSite {
	readonly task: TaskSymbol;
	readonly attribute: FastAttr;
	readonly file: WorkspacePath;
	/** 1-based. */
	readonly line: number;
	/** The value as written. */
	readonly value: string;
}

const DURATIONS: ReadonlySet<string> = new Set(['effort', 'length', 'duration', 'milestone']);
/** The statements that set the same attributes as a keyword (TjpSyntaxRules.rb, rule_taskPeriod). */
const FAMILIES: Partial<Record<FastAttr, ReadonlySet<string>>> = {
	effort: DURATIONS,
	length: DURATIONS,
	duration: DURATIONS,
	start: new Set(['start', 'period']),
	end: new Set(['end', 'period']),
};
/** Keywords children copy from their parent when they are created (Project.rb attribute table). */
const INHERITED: ReadonlySet<string> = new Set(['priority']);
const DURATION_VALUE = /^\d+(?:\.\d+)?(?:min|h|d|w|m|y)$/;
const DATE_VALUE =
	/^\d{4}-\d{2}-\d{2}(?:-\d{1,2}:\d{2}(?::\d{2})?)?(?:-(?:[+-]\d{4}|[A-Za-z][A-Za-z0-9_+/-]*))?$/;
/** The values each keyword may take in a fast patch, as strictly as the bridge checks them. */
export const FAST_VALUES: Readonly<Record<FastAttr, RegExp>> = {
	effort: DURATION_VALUE,
	length: DURATION_VALUE,
	duration: DURATION_VALUE,
	start: DATE_VALUE,
	end: DATE_VALUE,
	priority: /^\d{1,4}$/,
	complete: /^\d{1,3}(?:\.\d+)?$/,
};

const isFastAttr = (k: string): k is FastAttr => (FAST_ATTRS as readonly string[]).includes(k);

/** A lone `<keyword> <value>` statement, with an optional comment: the value, or null. */
export function statementValue(line: string, keyword: FastAttr): string | null {
	const m = new RegExp(`^[ \\t]*${keyword}[ \\t]+([^\\s#]+)[ \\t]*(?:(?:#|//).*)?\\r?$`).exec(line);
	const value = m?.[1] ?? null;
	return value !== null && FAST_VALUES[keyword].test(value) ? value : null;
}

/** The sites of a snapshot (module comment), with `index` built for it. */
export function fastSites(snap: WorkspaceSnapshot, index: SymbolIndex): FastSite[] {
	const visitsOf = new Map<WorkspacePath, number>();
	for (const v of index.visits) visitsOf.set(v.file, (visitsOf.get(v.file) ?? 0) + 1);
	const out: FastSite[] = [];
	for (const task of index.tasks.values()) {
		if (task.textOnly || task.expandedOnly || task.bodyMacroCalls.length > 0) continue;
		if (task.sharedWith.length > 0) continue;
		for (const a of task.attrs) {
			const keyword = a.keyword;
			if (!isFastAttr(keyword) || a.scenario !== null || !a.value || a.textOnly) continue;
			if (INHERITED.has(keyword) && task.children.length > 0) continue;
			const family = FAMILIES[keyword] ?? new Set([keyword]);
			if (task.attrs.filter((b) => family.has(b.keyword)).length !== 1) continue;
			if ((visitsOf.get(a.statement.file) ?? 0) > 1) continue;
			const text = snap.files.get(a.statement.file)?.text;
			if (!text) continue;
			const line = text.lineAt(a.statement.from);
			if (text.lineAt(a.statement.to).number !== line.number) continue;
			const value = statementValue(line.text, keyword);
			if (value === null) continue;
			out.push({ task, attribute: keyword, file: a.statement.file, line: line.number, value });
		}
	}
	return out;
}

/**
 * The fast edits of `changes` (per file, from the texts of `before`), or null when any changed
 * range is not inside one site's line, a line count changes, or a new line is not a lone
 * statement of its keyword with a strict value.
 */
export function fastEditsOf(
	before: WorkspaceSnapshot,
	index: SymbolIndex,
	changes: Readonly<Record<WorkspacePath, ChangeSet>>,
): FastEdit[] | null {
	const sites = new Map<string, FastSite>();
	for (const s of fastSites(before, index)) sites.set(`${s.file}\0${s.line}`, s);
	const edits: FastEdit[] = [];
	for (const [file, cs] of Object.entries(changes)) {
		const text = before.files.get(file)?.text;
		if (!text || cs.empty) continue;
		const after: Text = cs.apply(text);
		if (after.lines !== text.lines) return null;
		const lines = new Set<number>();
		let inside = true;
		cs.iterChangedRanges((from, to) => {
			const line = text.lineAt(from);
			if (text.lineAt(to).number !== line.number) inside = false;
			lines.add(line.number);
		});
		if (!inside) return null;
		for (const n of lines) {
			const site = sites.get(`${file}\0${n}`);
			if (!site) return null;
			const value = statementValue(after.line(n).text, site.attribute);
			if (value === null) return null;
			edits.push({
				task: site.task.id,
				attribute: site.attribute,
				scenario: null,
				value,
				file,
				line: n,
			});
		}
	}
	return edits.length > 0 ? edits : null;
}
