// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Applying the user's choices to a merge (types.ts `ResolveFn`). Each conflict's region in the
 * merged text (`at`) is replaced by the chosen text, from the last region of a file to the first,
 * so earlier offsets stay valid:
 * - `text` and `block`: ours, theirs, ours' lines then theirs' (`both`), or the user's text; a side
 *   without the region gives '' (Take mine on `deleted-ours` removes the block);
 * - `attribute`: the statement; a side without it, or '', removes it, and its line when nothing
 *   else is left on it; one theirs added (an empty `at`) goes on its own line, indented like the
 *   statements around it, with the line ending of the line it joins;
 * - `file`: the whole text; a chosen side without the file keeps the base text (the kept rule).
 */
import type { MergeConflict, Resolution, Take, Unresolved, Files, WorkspaceMerge } from './types';
import type { WorkspacePath } from '../../workspace/paths';

const indentOf = (line: string): string => /^[ \t]*/.exec(line)?.[0] ?? '';

function lineAt(text: string, pos: number): { from: number; to: number } {
	const from = text.lastIndexOf('\n', pos - 1) + 1;
	const nl = text.indexOf('\n', pos);
	return { from, to: nl < 0 ? text.length : nl };
}

/** The indentation for a statement inserted at `pos` (module comment). */
export function indentFor(text: string, pos: number): string {
	const unit = /\n\t/.test(text) ? '\t' : '  ';
	const here = lineAt(text, pos);
	const before = text.slice(here.from, pos);
	if (before.trim() !== '') {
		return indentOf(before) + (before.trimEnd().endsWith('{') ? unit : '');
	}
	for (let at = here.from; at < text.length;) {
		const l = lineAt(text, at);
		const s = text.slice(l.from, l.to);
		if (s.trim() !== '') {
			if (!s.trim().startsWith('}')) return indentOf(s);
			break;
		}
		at = l.to + 1;
	}
	for (let end = here.from - 1; end > 0;) {
		const l = lineAt(text, end);
		const s = text.slice(l.from, l.to);
		if (s.trim() !== '') return indentOf(s) + (s.trimEnd().endsWith('{') ? unit : '');
		end = l.from - 1;
	}
	return '';
}

/** `text` with `stmt` inserted at `pos` on a line of its own. */
export function insertStatement(text: string, pos: number, stmt: string): string {
	const here = lineAt(text, pos);
	const eol = text[here.to - 1] === '\r' ? '\r\n' : '\n';
	const indent = indentFor(text, pos);
	if (text.slice(here.from, pos).trim() === '') {
		return text.slice(0, here.from) + indent + stmt + eol + text.slice(here.from);
	}
	return text.slice(0, pos) + eol + indent + stmt + text.slice(pos);
}

/** `text` without [from, to), and without its line when only whitespace is left on it. */
export function removeStatement(text: string, from: number, to: number): string {
	const out = text.slice(0, from) + text.slice(to);
	if (to === from) return out;
	const l = lineAt(out, from);
	if (out.slice(l.from, l.to).trim() !== '') return out;
	return out.slice(0, l.from) + out.slice(l.to < out.length ? l.to + 1 : l.to);
}

function joinBoth(ours: string, theirs: string): string {
	if (ours === '' || theirs === '' || ours.endsWith('\n')) return ours + theirs;
	return `${ours}\n${theirs}`;
}

function apply(text: string, c: MergeConflict, take: Take): string {
	const { from, to } = c.at;
	const s = c.subject;
	if (s.kind === 'file') {
		if (typeof take === 'object') return take.text;
		return (take === 'theirs' ? c.theirs : c.ours) ?? c.base ?? '';
	}
	const chosen =
		typeof take === 'object'
			? take.text
			: take === 'both'
				? joinBoth(c.ours ?? '', c.theirs ?? '')
				: ((take === 'ours' ? c.ours : c.theirs) ?? '');
	if (s.kind !== 'attribute') return text.slice(0, from) + chosen + text.slice(to);
	if (chosen === '') return removeStatement(text, from, to);
	if (from === to) return insertStatement(text, from, chosen);
	return text.slice(0, from) + chosen + text.slice(to);
}

/** types.ts `ResolveFn` (module comment). */
export function resolve(m: WorkspaceMerge, rs: readonly Resolution[]): Files | Unresolved {
	const known = new Map(m.conflicts.map((c) => [c.id, c]));
	const choice = new Map<string, Take>();
	for (const r of rs) if (known.has(r.conflict)) choice.set(r.conflict, r.take);
	const unresolved = m.conflicts
		.filter((c) => {
			const t = choice.get(c.id);
			return t === undefined || (t === 'both' && !c.both);
		})
		.map((c) => c.id);
	if (unresolved.length > 0) return { unresolved };
	const byFile = new Map<WorkspacePath, MergeConflict[]>();
	for (const c of m.conflicts) {
		const list = byFile.get(c.file);
		if (list) list.push(c);
		else byFile.set(c.file, [c]);
	}
	const out = new Map(m.files);
	for (const [file, list] of byFile) {
		let text = out.get(file) ?? '';
		const order = [...list].sort((x, y) => y.at.from - x.at.from || y.at.to - x.at.to);
		for (const c of order) text = apply(text, c, choice.get(c.id) as Take);
		out.set(file, text);
	}
	return out;
}
