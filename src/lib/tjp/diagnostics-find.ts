// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Tree searches for the refinement of engine messages (diagnostics-refine.ts): tokens on a
 * line, declarations whose header is on a line, a declaration's own attributes and references,
 * and statements by keyword near a line. All work on the text that was scheduled.
 */
import type { SyntaxNode } from '@lezer/common';
import type { TjpFile } from './document';
import {
	engineLine,
	leavesIn,
	textString,
	TRIVIA,
	type Leaf,
	type LineSpan,
	type Span,
} from './diagnostics-lines';
import { bodyOf, statementHead, statementKeyword, statementsIn } from './tree';

const DECLS: ReadonlySet<string> = new Set(['TaskStatement', 'ResourceStatement']);
const NESTED: ReadonlySet<string> = new Set([
	'TaskStatement',
	'ResourceStatement',
	'SupplementStatement',
]);
/** How far back (in engine lines) a message may sit after the statement it is about. */
export const LOOK_BACK = 50;

export class LineSearch {
	readonly text: string;
	#leaves: Leaf[] | null = null;

	constructor(
		readonly file: TjpFile,
		readonly line: LineSpan,
	) {
		this.text = textString(file.text);
	}

	slice(s: Span): string {
		return this.text.slice(s.from, s.to);
	}

	/** Content leaves on the line (no comments, no zero-width error nodes). */
	get leaves(): Leaf[] {
		this.#leaves ??= leavesIn(this.file.tree, this.line.from, this.line.to).filter(
			(l) => l.from < l.to && !TRIVIA.has(l.name),
		);
		return this.#leaves;
	}

	/** Start of the first error node on the line, or null. */
	errorStart(): number | null {
		for (const l of leavesIn(this.file.tree, this.line.from, this.line.to)) {
			if (l.node.type.isError || l.node.parent?.type.isError) return l.from;
		}
		return null;
	}

	/**
	 * A token on the line written as `x` (a string token also matches its content). With several,
	 * the first at or after a syntax error on the line, else the first.
	 */
	token(x: string): Span | null {
		const hits = this.leaves.filter((l) => {
			const t = this.slice(l);
			return t === x || (l.name === 'String' && t.length >= 2 && t.slice(1, -1) === x);
		});
		const err = this.errorStart();
		const hit = (err === null ? undefined : hits.find((h) => h.from >= err)) ?? hits[0];
		return hit ? { from: hit.from, to: Math.min(hit.to, this.line.to) } : null;
	}

	/** The part of `s` on the line, without blanks at either end; null for null. */
	onLine(s: Span | null): Span | null {
		if (!s) return null;
		let from = Math.max(s.from, this.line.from);
		let to = Math.min(s.to, this.line.to);
		while (from < to && /\s/.test(this.text.charAt(from))) from++;
		while (to > from && /\s/.test(this.text.charAt(to - 1))) to--;
		return { from, to };
	}

	/** The first leaf on the line with one of these names. */
	leafNamed(...names: string[]): Leaf | null {
		return this.leaves.find((l) => names.includes(l.name)) ?? null;
	}

	/** Task and resource declarations whose keyword is on the line. */
	declsOnLine(): SyntaxNode[] {
		const out: SyntaxNode[] = [];
		for (const l of this.leaves) {
			const p = l.node.parent;
			if (l.name === 'Keyword' && p && DECLS.has(p.name)) out.push(p);
		}
		return out;
	}

	/** The declaration on the line whose local id is the last segment of `id`; or the only one. */
	decl(kind: 'task' | 'resource' | null, id: string | null): SyntaxNode | null {
		const want = kind === null ? null : kind === 'task' ? 'TaskStatement' : 'ResourceStatement';
		const decls = this.declsOnLine().filter((d) => want === null || d.name === want);
		if (id !== null) {
			const local = id.slice(id.lastIndexOf('.') + 1);
			const hit = decls.find((d) => {
				const i = d.getChild('Id');
				return i !== null && this.slice(i) === local;
			});
			if (hit) return hit;
		}
		return decls.length === 1 ? (decls[0] ?? null) : null;
	}

	/** Statements other than declarations whose head starts on the line. */
	statementsOnLine(): SyntaxNode[] {
		const out: SyntaxNode[] = [];
		for (const l of this.leaves) {
			const p = l.node.parent;
			if (!p || !p.name.endsWith('Statement') || NESTED.has(p.name)) continue;
			if (statementHead(p)?.from === l.from) out.push(p);
		}
		return out;
	}

	/**
	 * The statement led by one of `keywords` (compared in lower case) on the line, else the
	 * nearest one that ends before the line ends, at most LOOK_BACK lines back.
	 */
	statementBefore(keywords: readonly string[]): SyntaxNode | null {
		const want = new Set(keywords.map((k) => k.toLowerCase()));
		const kw = (s: SyntaxNode) => statementKeyword(s, this.text)?.toLowerCase() ?? '';
		const on = this.statementsOnLine().find((s) => want.has(kw(s)));
		if (on) return on;
		const from = engineLine(this.file.text, this.line.number - LOOK_BACK).from;
		let best: SyntaxNode | null = null;
		this.file.tree.iterate({
			from,
			to: this.line.to,
			enter: (n) => {
				if (!n.name.endsWith('Statement') || n.to > this.line.to || n.from < from) return undefined;
				const node = n.node;
				if (want.has(kw(node)) && (!best || node.from > best.from)) best = node;
				return undefined;
			},
		});
		return best;
	}

	/** The `macro <name>` definition nearest before the end of the line. */
	macroBefore(name: string): Span | null {
		const from = engineLine(this.file.text, this.line.number - LOOK_BACK).from;
		let best: Span | null = null;
		this.file.tree.iterate({
			from,
			to: this.line.to,
			enter: (n) => {
				if (n.name !== 'MacroStatement' || n.from > this.line.to) return undefined;
				const id = n.node.getChild('Identifier');
				if (id && this.slice(id) === name && (!best || id.from > best.from)) {
					best = { from: id.from, to: id.to };
				}
				return false;
			},
		});
		return best;
	}
}

/** A declaration's header: from its start through the name (or id, or keyword). */
export function headerOf(decl: SyntaxNode): Span {
	const end = decl.getChild('Name') ?? decl.getChild('Id') ?? statementHead(decl) ?? decl;
	return { from: decl.from, to: end.to };
}

/** The statements of a declaration's body other than nested declarations and supplements. */
export function ownAttributes(decl: SyntaxNode): SyntaxNode[] {
	const body = bodyOf(decl);
	return body ? statementsIn(body).filter((s) => !NESTED.has(s.name)) : [];
}

/** The scenario of a statement's prefix (`delayed:` gives 'delayed'), or null. */
export function scenarioOf(stmt: SyntaxNode, text: string): string | null {
	const p = stmt.firstChild;
	return p?.name === 'ScenarioPrefix' ? text.slice(p.from, p.to).replace(/\s*:$/, '') : null;
}

/**
 * Of statements led by `keyword`, the one TaskJuggler keeps for `scenario`: the last with that
 * prefix, else the last without a prefix, else the last.
 */
export function pickForScenario<T>(
	items: readonly T[],
	scenarioOfItem: (t: T) => string | null,
	scenario: string | null,
): T | null {
	const last = (f: (t: T) => boolean): T | null => {
		for (let i = items.length - 1; i >= 0; i--) {
			const t = items[i] as T;
			if (f(t)) return t;
		}
		return null;
	};
	return (
		(scenario === null ? null : last((t) => scenarioOfItem(t) === scenario)) ??
		last((t) => scenarioOfItem(t) === null) ??
		last(() => true)
	);
}

/** Leaves of the attribute statements of a declaration whose parent node is one of `parents`. */
export function refLeaves(decl: SyntaxNode, parents: ReadonlySet<string>): SyntaxNode[] {
	const out: SyntaxNode[] = [];
	const walk = (n: SyntaxNode): void => {
		for (let c = n.firstChild; c; c = c.nextSibling) {
			if (c.name.endsWith('Statement') && NESTED.has(c.name)) continue;
			if (parents.has(c.name)) out.push(c);
			else walk(c);
		}
	};
	for (const s of ownAttributes(decl)) walk(s);
	return out;
}

/** Whether a written reference (`!x`, `a.x`) can be the resolved id `id`. */
export function sameRef(written: string, id: string): boolean {
	const bare = written.replace(/^!+/, '');
	return bare === id || id.endsWith(`.${bare}`) || (written === bare && bare.endsWith(`.${id}`));
}
