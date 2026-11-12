// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Builds the facts of one file (facts.ts) from its tree. Only typed bodies are entered: the
 * file level, the `project` body, `task`/`resource` bodies and `supplement` bodies. Macro bodies
 * are single tokens, so declarations written inside macro definitions are never seen (X1);
 * opaque statements are kept as opaque attributes, except `scenario` and `extend` in the project
 * body, whose tokens are read (15.2).
 */
import type { SyntaxNode } from '@lezer/common';
import type { TjpFile } from '../document';
import { isRecoveryStatement, MACRO_TOKENS } from '../grammar/parser';
import { textOnlyRanges } from '../text-only';
import { statementHead, statementsIn, type SourceRange } from '../tree';
import { parseString } from '../values';
import type { BodyItem, DeclFact, FileFacts, ProjectFact, SupplementFact } from './facts';
import { blockingIn, rangeIndex, type RangeIndex } from './ranges';
import { attrFact, extendFact, macroFact, scenarioFact } from './scan-items';
import type { DeclSite, PropertyKind } from './types';

export type Scope = 'global' | 'prolog' | 'project' | PropertyKind;

/** Shared state of one file scan. */
export interface ScanCtx {
	readonly file: TjpFile;
	readonly text: string;
	readonly ranges: RangeIndex;
	readonly headerLines: Map<string, number>;
	readonly headerLiterals: Map<string, string[]>;
	range(n: { readonly from: number; readonly to: number }): SourceRange;
	slice(n: { readonly from: number; readonly to: number }): string;
}

export function scanFile(file: TjpFile): FileFacts {
	const text = file.text.toString();
	// Every non-literal id as resolved and every statement-level macro call as safe: the link adds
	// the wider X4 and X3 ranges where hints or macro definitions say so.
	const base = textOnlyRanges(file.path, file.tree, text, {
		resolved: () => true,
		safeMacro: () => true,
	});
	const ranges = rangeIndex(base);
	const ctx: ScanCtx = {
		file,
		text,
		ranges,
		headerLines: new Map(),
		headerLiterals: new Map(),
		range: (n) => ({ file: file.path, from: n.from, to: n.to }),
		slice: (n) => text.slice(n.from, n.to),
	};
	const scope: Scope = file.top === 'project' ? 'project' : file.top;
	const items = scanBody(ctx, file.tree.topNode, scope, 'decl');
	return {
		file,
		top: file.top,
		items,
		ranges,
		headerLines: ctx.headerLines,
		headerLiterals: ctx.headerLiterals,
		opaque: outermost(base.filter((t) => t.reason === 'opaque' || t.reason === 'macro-body')),
	};
}

function outermost<T extends { at: SourceRange }>(sorted: readonly T[]): T[] {
	const out: T[] = [];
	let end = -1;
	for (const t of sorted) {
		if (t.at.from >= end) {
			out.push(t);
			end = t.at.to;
		} else if (t.at.to > end) {
			out.push(t);
			end = t.at.to;
		}
	}
	return out;
}

/** The statements of a `File` or `Body` node as facts. */
export function scanBody(
	ctx: ScanCtx,
	parent: SyntaxNode,
	scope: Scope,
	site: 'decl' | 'supplement',
): BodyItem[] {
	const out: BodyItem[] = [];
	for (const stmt of statementsIn(parent)) {
		const item = scanStatement(ctx, stmt, scope, site);
		if (item) out.push(item);
	}
	return out;
}

function scanStatement(
	ctx: ScanCtx,
	stmt: SyntaxNode,
	scope: Scope,
	site: 'decl' | 'supplement',
): BodyItem | null {
	switch (stmt.name) {
		case 'ProjectStatement':
			return projectFact(ctx, stmt);
		case 'TaskStatement':
			return declFact(ctx, stmt, 'task');
		case 'ResourceStatement':
			return declFact(ctx, stmt, 'resource');
		case 'SupplementStatement':
			return supplementFact(ctx, stmt);
		case 'IncludeStatement':
			return { t: 'include', at: ctx.range(stmt) };
		case 'MacroStatement':
			return macroFact(ctx, stmt);
		case 'MacroCallStatement':
			return isRecoveryStatement(stmt) ? null : { t: 'macroCall', at: ctx.range(stmt) };
		case 'OpaqueStatement': {
			if (scope === 'project') {
				const head = statementHead(stmt);
				const kw = head?.name === 'Keyword' ? ctx.slice(head) : null;
				if (kw === 'scenario') return scenarioFact(ctx, stmt);
				if (kw === 'extend') return extendFact(ctx, stmt);
			}
			return attrFact(ctx, stmt, site);
		}
		default:
			return attrFact(ctx, stmt, site);
	}
}

/** The end of a declaration header: the last of its leading children before the body. */
function headerEnd(stmt: SyntaxNode): number {
	let end = stmt.from;
	for (let c = stmt.firstChild; c; c = c.nextSibling) {
		if (c.name === 'Body') break;
		if (c.name !== 'LineComment' && c.name !== 'BlockComment') end = c.to;
	}
	return end;
}

/** The first child of each name, in one pass (cheaper than repeated `getChild`). */
export function childrenOf(node: SyntaxNode): Map<string, SyntaxNode> {
	const out = new Map<string, SyntaxNode>();
	for (let c = node.firstChild; c; c = c.nextSibling) if (!out.has(c.name)) out.set(c.name, c);
	return out;
}

function declSite(
	ctx: ScanCtx,
	stmt: SyntaxNode,
	id: SyntaxNode | null,
	kids: Map<string, SyntaxNode>,
): DeclSite {
	const body = kids.get('Body') ?? null;
	const name = kids.get('Name') ?? null;
	return {
		header: ctx.range({ from: stmt.from, to: headerEnd(stmt) }),
		id: id ? ctx.range(id) : null,
		name: name ? ctx.range(name) : null,
		block: ctx.range(stmt),
		body: body ? ctx.range(body) : null,
		leadingComments: leadingComments(ctx, stmt.from),
	};
}

/** A `"…"`/`'…'` string's value; the lexer only for escapes and cut-here strings. */
export function stringValue(raw: string): string | null {
	const q = raw[0];
	if ((q === '"' || q === "'") && raw.length >= 2 && raw.endsWith(q) && !raw.includes('\\')) {
		return raw.slice(1, -1);
	}
	const r = parseString(raw);
	return r.ok ? r.value : null;
}

function nameOf(ctx: ScanCtx, node: SyntaxNode | undefined): string | null {
	const s = node?.firstChild;
	if (!s || s.name !== 'String') return null;
	return stringValue(ctx.slice(s));
}

function declFact(ctx: ScanCtx, stmt: SyntaxNode, kind: PropertyKind): DeclFact {
	const kids = childrenOf(stmt);
	const id = kids.get('Id') ?? null;
	const literal = id?.firstChild?.name === 'Identifier';
	const keyword = statementHead(stmt) ?? stmt;
	const line = ctx.file.text.lineAt(keyword.from).number;
	const key = `${kind}:${line}`;
	ctx.headerLines.set(key, (ctx.headerLines.get(key) ?? 0) + 1);
	if (literal && id) {
		const list = ctx.headerLiterals.get(key);
		if (list) list.push(ctx.slice(id));
		else ctx.headerLiterals.set(key, [ctx.slice(id)]);
	}
	const body = kids.get('Body');
	return {
		t: 'decl',
		kind,
		site: declSite(ctx, stmt, id, kids),
		line,
		idForm: literal ? 'literal' : id ? 'macro' : 'auto',
		localId: literal && id ? ctx.slice(id) : null,
		name: nameOf(ctx, kids.get('Name')),
		textOnly: blockingIn(ctx.ranges, stmt.from, stmt.to),
		body: body ? scanBody(ctx, body, kind, 'decl') : [],
	};
}

function supplementFact(ctx: ScanCtx, stmt: SyntaxNode): SupplementFact {
	const kids = childrenOf(stmt);
	const kindNode = kids.get('SupplementKind');
	const k = kindNode ? ctx.slice(kindNode) : null;
	const kind: PropertyKind | null = k === 'task' || k === 'resource' ? k : null;
	const ref = kids.get('Ref') ?? null;
	const refLeaf = ref?.firstChild ?? null;
	const literal = refLeaf !== null && !MACRO_TOKENS.has(refLeaf.name);
	const body = kids.get('Body');
	return {
		t: 'supplement',
		kind,
		site: declSite(ctx, stmt, ref, kids),
		written: literal && ref ? ctx.slice(ref) : null,
		refAt: ref ? ctx.range(ref) : null,
		body: body && kind ? scanBody(ctx, body, kind, 'supplement') : [],
	};
}

function projectFact(ctx: ScanCtx, stmt: SyntaxNode): ProjectFact {
	const kids = childrenOf(stmt);
	const id = kids.get('Id') ?? null;
	const interval = kids.get('Interval') ?? null;
	const macro = interval !== null && hasLeaf(interval, (n) => MACRO_TOKENS.has(n.name));
	const body = kids.get('Body');
	const site = declSite(ctx, stmt, id, kids);
	return {
		t: 'project',
		site,
		id: id?.firstChild?.name === 'Identifier' ? ctx.slice(id) : null,
		name: nameOf(ctx, kids.get('Name')),
		version: nameOf(ctx, kids.get('Version')),
		interval: interval ? ctx.range(interval) : null,
		intervalText: interval && !macro ? ctx.slice(interval) : null,
		textOnly: blockingIn(ctx.ranges, site.header.from, site.header.to),
		body: body ? scanBody(ctx, body, 'project', 'decl') : [],
	};
}

/** Whether some leaf below `node` satisfies `f`. */
export function hasLeaf(node: SyntaxNode, f: (leaf: SyntaxNode) => boolean): boolean {
	for (let c = node.firstChild; c; c = c.nextSibling) {
		if (c.firstChild ? hasLeaf(c, f) : f(c)) return true;
	}
	return false;
}

const COMMENTS: ReadonlySet<string> = new Set(['LineComment', 'BlockComment']);

/**
 * Comment lines directly above the statement at `from`: each must start its line, end on the
 * line above the previous one (or the statement), with no blank line between.
 */
function leadingComments(ctx: ScanCtx, from: number): SourceRange | null {
	const doc = ctx.file.text;
	const first = doc.lineAt(from);
	if (ctx.text.slice(first.from, from).trim() !== '') return null;
	let start = -1;
	let lineNo = first.number - 1;
	while (lineNo >= 1) {
		const line = doc.line(lineNo);
		const trimmed = line.text.trimEnd();
		if (trimmed.trim() === '') break;
		const last = line.from + trimmed.length - 1;
		const node = ctx.file.tree.resolveInner(last, 1);
		if (!COMMENTS.has(node.name) || node.to !== last + 1) break;
		const own = doc.lineAt(node.from);
		if (ctx.text.slice(own.from, node.from).trim() !== '') break;
		start = node.from;
		lineNo = own.number - 1;
	}
	if (start < 0) return null;
	const end = doc.line(first.number - 1);
	return ctx.range({ from: start, to: end.from + end.text.trimEnd().length });
}
