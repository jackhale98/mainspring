// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Facts of single statements: attributes (typed or opaque) with their list items, macro
 * definitions, and the `scenario` and `extend` declarations of the project body, whose
 * statements are opaque in the grammar (15.2) and are read token by token here, following
 * rule_scenarioHeader and rule_extendAttributes (TjpSyntaxRules.rb:5173, 1250).
 */
import type { SyntaxNode } from '@lezer/common';
import { MACRO_TOKENS, TYPED_STATEMENTS } from '../grammar/parser';
import { tokenizeTjp } from '../grammar/tokens';
import { statementHead, statementsIn } from '../tree';
import { KEYWORD_VALUE_KIND } from '../values';
import {
	LazyAttr,
	type AttrFact,
	type ExtendAttrFact,
	type ExtendFact,
	type ListItemFact,
	type MacroFact,
	type ScenarioFact,
} from './facts';
import { blockingIn } from './ranges';
import { stringValue, type ScanCtx } from './scan';

/** The scenario of a statement's prefix (`delayed:` → 'delayed'), or null. */
function scenarioOf(ctx: ScanCtx, stmt: SyntaxNode): string | null {
	const p = stmt.firstChild;
	if (p?.name !== 'ScenarioPrefix') return null;
	return ctx.slice(p).replace(/\s*:$/, '');
}

const LIST_ITEMS: Readonly<Record<string, string>> = {
	DependsStatement: 'DepItem',
	PrecedesStatement: 'DepItem',
	AllocateStatement: 'AllocItem',
	ResponsibleStatement: 'ResourceRef',
	ManagersStatement: 'ResourceRef',
	FlagsStatement: 'Flag',
	LeavesStatement: 'Leave',
	VacationStatement: 'Interval',
};

export function attrFact(ctx: ScanCtx, stmt: SyntaxNode, site: 'decl' | 'supplement'): AttrFact {
	const head = statementHead(stmt);
	const keyword = head ? ctx.slice(head) : '';
	const first = head?.nextSibling ?? null;
	const typed = TYPED_STATEMENTS.has(stmt.name);
	const statement = ctx.range(stmt);
	const attr = new LazyAttr(
		{
			keyword,
			scenario: scenarioOf(ctx, stmt),
			statement,
			value: first ? ctx.range({ from: first.from, to: stmt.to }) : null,
			site,
			textOnly: blockingIn(ctx.ranges, stmt.from, stmt.to),
		},
		ctx.file.text,
		typed ? (KEYWORD_VALUE_KIND[keyword] ?? null) : null,
	);
	const itemName = LIST_ITEMS[stmt.name];
	const items: ListItemFact[] = [];
	if (itemName) {
		for (let c = head?.nextSibling ?? null; c; c = c.nextSibling) {
			if (c.name === itemName) items.push(listItem(ctx, c));
		}
	}
	const custom = stmt.name === 'ExtensionStatement' && head ? ctx.range(head) : null;
	return { t: 'attr', site: attr, items, custom };
}

function listItem(ctx: ScanCtx, item: SyntaxNode): ListItemFact {
	let ref = item;
	let body: SyntaxNode | null = null;
	for (let c = item.firstChild; c; c = c.nextSibling) {
		if (c.name === 'TaskRef' || c.name === 'ResourceRef') ref = c;
		else if (c.name === 'Body') body = c;
	}
	let up = 0;
	let leaf: SyntaxNode | null = null;
	for (let c = ref.firstChild; c; c = c.nextSibling) {
		if (c.name === 'Bang') up++;
		else leaf = c;
	}
	if (ref === item && !ref.firstChild) leaf = ref;
	const literal = leaf !== null && (leaf.name === 'Identifier' || leaf.name === 'AbsoluteId');
	return {
		item: ctx.range(item),
		ref: ctx.range(ref),
		written: ctx.slice(ref),
		up,
		path: literal && leaf ? ctx.slice(leaf) : null,
		body: body ? ctx.range(body) : null,
		textOnly: blockingIn(ctx.ranges, item.from, item.to),
	};
}

const WORD = /[A-Za-z_]\w*/g;

export function macroFact(ctx: ScanCtx, stmt: SyntaxNode): MacroFact | null {
	const head = statementHead(stmt);
	const nameNode = head?.nextSibling ?? null;
	const body = stmt.getChild('MacroBody');
	if (!nameNode || !body) return null;
	const raw = ctx.slice(body);
	const text = raw.slice(1, raw.endsWith(']') ? -1 : undefined);
	return {
		t: 'macro',
		name: nameNode.name === 'Identifier' ? ctx.slice(nameNode) : null,
		nameAt: ctx.range(nameNode),
		statement: ctx.range(stmt),
		body: ctx.range(body),
		text,
		nestedCalls: /\$[{(]/.test(text),
		words: new Set(text.match(WORD) ?? []),
		structural: structuralRisk(text),
	};
}

/**
 * Why splicing a macro body into a line can change the structure around the call, or null.
 * TaskJuggler injects the expansion into the line it reads (Scanner.rb:78-90), so a body that
 * opens or closes blocks, starts a comment, or leaves a string, cut-here string, comment or
 * macro unterminated reshapes the text after the call (native: `${close} task b` declares a
 * top-level `b`; `${c}` with `c` = `#` comments out the rest of the line). Read with the
 * scanner port (grammar/tokens.ts).
 */
export function structuralRisk(text: string): 'braces' | 'comment' | 'unterminated' | null {
	let depth = 0;
	for (const t of tokenizeTjp(text)) {
		if (t.kind === 'LineComment' || t.kind === 'BlockComment') return 'comment';
		if (t.kind === 'Error' || t.kind === 'MacroBody') return 'unterminated';
		if (t.kind !== 'Punct') continue;
		const c = text.slice(t.from, t.to);
		if (c === '{') depth++;
		else if (c === '}' && --depth < 0) return 'braces';
	}
	return depth === 0 ? null : 'braces';
}

/** The leaf children of an opaque statement after its head, and its body. */
function opaqueParts(stmt: SyntaxNode): { args: SyntaxNode[]; body: SyntaxNode | null } {
	const head = statementHead(stmt);
	const args: SyntaxNode[] = [];
	let body: SyntaxNode | null = null;
	for (let c = head?.nextSibling ?? null; c; c = c.nextSibling) {
		if (c.name === 'Body') {
			body ??= c;
		} else if (!body && c.name !== 'LineComment' && c.name !== 'BlockComment') {
			args.push(c);
		}
	}
	return { args, body };
}

function stringArg(ctx: ScanCtx, n: SyntaxNode | undefined): string | null {
	return n?.name === 'String' ? stringValue(ctx.slice(n)) : null;
}

const keywordOf = (ctx: ScanCtx, stmt: SyntaxNode): string | null => {
	const h = statementHead(stmt);
	return h?.name === 'Keyword' ? ctx.slice(h) : null;
};

/** `scenario <id> "<name>" { scenario … }`; null when the id is not a literal identifier. */
export function scenarioFact(ctx: ScanCtx, stmt: SyntaxNode): ScenarioFact | null {
	const { args, body } = opaqueParts(stmt);
	const id = args[0];
	if (id?.name !== 'Identifier') return null;
	const children: ScenarioFact[] = [];
	if (body) {
		for (const s of statementsIn(body)) {
			if (keywordOf(ctx, s) !== 'scenario') continue;
			const child = scenarioFact(ctx, s);
			if (child) children.push(child);
		}
	}
	return {
		t: 'scenario',
		id: ctx.slice(id),
		idAt: ctx.range(id),
		name: stringArg(ctx, args[1]),
		statement: ctx.range(stmt),
		children,
	};
}

const EXTEND_TYPES: ReadonlySet<string> = new Set([
	'date',
	'number',
	'reference',
	'richtext',
	'text',
]);

/** `extend task|resource { <type> <Id> "<name>" { inherit scenariospecific } … }`. */
export function extendFact(ctx: ScanCtx, stmt: SyntaxNode): ExtendFact {
	const { args, body } = opaqueParts(stmt);
	const scopeText = args[0] && !MACRO_TOKENS.has(args[0].name) ? ctx.slice(args[0]) : null;
	const scope = scopeText === 'task' || scopeText === 'resource' ? scopeText : null;
	const attrs: ExtendAttrFact[] = [];
	if (body) {
		for (const s of statementsIn(body)) {
			const type = keywordOf(ctx, s);
			if (type === null || !EXTEND_TYPES.has(type)) continue;
			const parts = opaqueParts(s);
			const id = parts.args[0];
			if (!id || (id.name !== 'Identifier' && id.name !== 'AttributeName')) continue;
			const opts = new Set<string>();
			if (parts.body) {
				for (const o of statementsIn(parts.body)) {
					const k = keywordOf(ctx, o);
					if (k) opts.add(k);
				}
			}
			attrs.push({
				type,
				id: ctx.slice(id),
				idAt: ctx.range(id),
				name: stringArg(ctx, parts.args[1]),
				statement: ctx.range(s),
				inherit: opts.has('inherit'),
				scenarioSpecific: opts.has('scenariospecific'),
			});
		}
	}
	return { t: 'extend', scope, statement: ctx.range(stmt), attrs };
}
