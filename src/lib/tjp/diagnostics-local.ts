// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Diagnostics the document layer finds without the engine (phase-1.md 6.6 items 5, 15.2):
 *
 * - syntax: the tree's error nodes. Neighbouring error nodes on one line (`colour "red"`) are one
 *   diagnostic; a zero-width error is widened to the token after it; an unterminated token
 *   (`ScanError`, which runs to the end of the file) is marked on its first line only; an error
 *   at the end of the file sits after the last content.
 * - value: `checkValue` errors of typed statements (diagnostics-values.ts), codes only, with the
 *   text from `diagnosticStrings.value`.
 * - attribute: an `ExtensionStatement` whose name no `extend` declares (15.2), with a "did you
 *   mean" hint when it matches a keyword of its scope, or a declared attribute, ignoring case.
 *
 * Value and attribute diagnostics that overlap a syntax diagnostic are dropped.
 */
import type { WorkspacePath } from '../../engine/protocol';
import { diagnosticStrings as S } from '../strings';
import type { WorkspaceSnapshot } from '../workspace/workspace';
import type { TjpFile } from './document';
import { engineLine, engineLineAt, leavesIn, lineColumn, textString } from './diagnostics-lines';
import type { TjpDiagnostic } from './diagnostics-types';
import { checkedStatements, statementValueError } from './diagnostics-values';
import type { SymbolIndex } from './index/types';
import { keywordsInContext } from './syntax/keywords';
import { syntaxIssues } from './tree';

type Local = Omit<TjpDiagnostic, 'line' | 'column'>;

function located(file: TjpFile, d: Local): TjpDiagnostic {
	const { line, column } = lineColumn(file.text, d.from);
	return { ...d, line, column };
}

function base(
	file: WorkspacePath,
	from: number,
	to: number,
): Pick<TjpDiagnostic, 'file' | 'from' | 'to' | 'scenario' | 'revision' | 'stale' | 'hint'> {
	return { file, from, to, scenario: null, revision: null, stale: false, hint: null };
}

const MAX_TOKEN = 40;

function quoteToken(s: string): string {
	const one = s.split(/[\r\n]/, 1)[0] ?? '';
	return `“${one.length > MAX_TOKEN ? `${one.slice(0, MAX_TOKEN)}…` : one}”`;
}

/** Syntax diagnostics of one file, from its error nodes. */
export function syntaxDiagnostics(file: TjpFile): TjpDiagnostic[] {
	const text = textString(file.text);
	const issues = syntaxIssues(file.tree, file.text);
	const merged: Array<{ from: number; to: number }> = [];
	for (const i of issues) {
		const last = merged[merged.length - 1];
		if (last && /^[ \t]*$/.test(text.slice(last.to, i.from))) last.to = Math.max(last.to, i.to);
		else merged.push({ from: i.from, to: i.to });
	}
	const out: TjpDiagnostic[] = [];
	for (const m of merged) {
		const d = syntaxDiagnostic(file, text, m.from, m.to);
		const prev = out[out.length - 1];
		if (prev && prev.from === d.from && prev.to === d.to) continue;
		out.push(d);
	}
	return out;
}

function syntaxDiagnostic(file: TjpFile, text: string, from: number, to: number): TjpDiagnostic {
	const leaves = leavesIn(file.tree, from, to).filter((l) => l.from < l.to);
	const lineEnd = engineLine(file.text, engineLineAt(file.text, from)).to;
	const mk = (a: number, b: number, id: string, message: string): TjpDiagnostic =>
		located(file, {
			...base(file.path, a, b),
			severity: 'error',
			source: 'syntax',
			precision: 'token',
			messageId: id,
			message,
		});
	if (leaves.some((l) => l.name === 'ScanError')) {
		return mk(
			from,
			Math.max(Math.min(to, lineEnd), from),
			'syntax:unterminated',
			S.syntax.unterminated,
		);
	}
	if (from === to) {
		if (from >= text.trimEnd().length) {
			const end = text.trimEnd().length;
			return mk(end, end, 'syntax:unexpected-end', S.syntax.unexpectedEnd);
		}
		const next = leavesIn(file.tree, from, lineEnd).find((l) => l.from >= from && l.to > l.from);
		if (next && next.from <= lineEnd) {
			return mk(
				next.from,
				next.to,
				'syntax:unexpected',
				S.syntax.unexpected(quoteToken(text.slice(next.from, next.to))),
			);
		}
		return mk(from, from, 'syntax:unexpected', S.syntax.unexpected(quoteToken('')));
	}
	if (leaves.length > 0 && leaves.every((l) => l.name === 'CloseBrace')) {
		return mk(from, to, 'syntax:extra-brace', S.syntax.extraBrace);
	}
	const first = leaves[0];
	const token = first ? text.slice(first.from, first.to) : text.slice(from, to);
	return mk(from, to, 'syntax:unexpected', S.syntax.unexpected(quoteToken(token)));
}

/** Value diagnostics of every file the include graph reads. Needs the index for the contexts. */
export function valueDiagnostics(ws: WorkspaceSnapshot, index: SymbolIndex): TjpDiagnostic[] {
	const out: TjpDiagnostic[] = [];
	const read = new Set(index.visits.map((v) => v.file));
	for (const [path, file] of ws.files) {
		if (!read.has(path)) continue;
		for (const stmt of checkedStatements(file)) {
			const e = statementValueError(file, stmt, index.contextAt(path, stmt.from));
			if (!e) continue;
			out.push(
				located(file, {
					...base(path, e.from, e.to),
					severity: 'error',
					source: 'value',
					precision: 'token',
					messageId: e.tj ?? `value:${e.code}`,
					message: S.value[e.code],
				}),
			);
		}
	}
	return out;
}

/** The keyword or declared attribute `name` matches ignoring case, for the hint. */
function suggestion(index: SymbolIndex, scope: 'task' | 'resource', name: string): string | null {
	const lower = name.toLowerCase();
	const kw = keywordsInContext(scope).find((k) => k.name.toLowerCase() === lower);
	if (kw) return kw.name;
	const attr = index.customAttributes.find(
		(a) => a.scope === scope && a.id !== name && a.id.toLowerCase() === lower,
	);
	return attr ? attr.id : null;
}

/** Undeclared custom attributes (15.2), one per statement however often its file is read. */
export function attributeDiagnostics(ws: WorkspaceSnapshot, index: SymbolIndex): TjpDiagnostic[] {
	const out: TjpDiagnostic[] = [];
	const seen = new Set<string>();
	for (const use of index.customAttributeUses) {
		if (use.declared) continue;
		const at = use.nameAt;
		const key = `${at.file}\0${at.from}\0${at.to}`;
		const file = ws.files.get(at.file);
		if (seen.has(key) || !file) continue;
		seen.add(key);
		const hint = suggestion(index, use.scope, use.name);
		out.push(
			located(file, {
				...base(at.file, at.from, at.to),
				hint: hint === null ? null : S.didYouMean(hint),
				severity: 'error',
				source: 'attribute',
				precision: 'token',
				messageId: 'attribute:undeclared',
				message: S.undeclaredAttribute(use.name),
			}),
		);
	}
	return out;
}

const overlaps = (a: TjpDiagnostic, b: TjpDiagnostic): boolean =>
	a.file === b.file && a.from <= b.to && b.from <= a.to;

/**
 * All local diagnostics of a workspace: syntax for every file, value and attribute checks when
 * an index of the same snapshot is given. Sorted by file and position.
 */
export function localDiagnostics(
	ws: WorkspaceSnapshot,
	index?: SymbolIndex | null,
): TjpDiagnostic[] {
	const syntax: TjpDiagnostic[] = [];
	for (const file of ws.files.values()) syntax.push(...syntaxDiagnostics(file));
	const checks =
		index && index.version === ws.version
			? [...valueDiagnostics(ws, index), ...attributeDiagnostics(ws, index)]
			: [];
	const kept = checks.filter((d) => !syntax.some((s) => overlaps(s, d)));
	return sortDiagnostics([...syntax, ...kept]);
}

/** Sorted by file, then position, then severity order of insertion. */
export function sortDiagnostics(list: readonly TjpDiagnostic[]): TjpDiagnostic[] {
	return [...list].sort((a, b) =>
		a.file === b.file ? a.from - b.from || a.to - b.to : (a.file ?? '') < (b.file ?? '') ? -1 : 1,
	);
}
