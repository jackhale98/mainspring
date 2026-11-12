// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * `setDependsGap` (phase-1.md 7.1; ADR-0003 #4): sets or clears the gap of the link between
 * `target` (predecessor) and `task` (successor) inside the link's item bodies.
 *
 * - The items: the link's unprefixed items (deps.ts `linkItems`: the successor's `depends`
 *   item, the predecessor's `precedes` item), else its scenario-prefixed ones. TaskJuggler
 *   honours every item, so all of them get the same gap. No item: noop `not-present` when
 *   clearing, `unknown-target` when setting.
 * - The value is checked as TaskJuggler reads it, with the project settings at the item:
 *   `gapduration` is an interval duration (never 0, a multiple of the timing resolution),
 *   `gaplength` a non-zero working duration (`invalid-value`).
 * - A gap of one kind leaves exactly one gap statement in each body: the last statement of that
 *   kind gets the new value (keeping a spelling that already means it), else the last statement
 *   of the other kind is rewritten as one of this kind, else `kind value` is added: before `}`
 *   in a one-line body, on its own line in a multi-line one, or in a new ` { … }` after the
 *   reference. Every other gap statement goes.
 * - Clearing removes every gap statement, and the body with it when nothing else (no `onend`,
 *   no comment) is left in it.
 *
 * It edits item bodies, so it is refused in shared files (15.16, `sameInEveryVisit` false).
 */
import type { SyntaxNode } from '@lezer/common';
import type { TjpFile } from '../document';
import { statementsIn } from '../tree';
import { itemNode } from './dep-graph';
import { linkItems, linkTasks, unprefixed } from './deps-links';
import {
	fileText,
	indentUnit,
	isBlank,
	isBlankChar,
	lineBreakNear,
	lineIndent,
	lineStart,
	removeStatements,
	replaceSpan,
	replaceValue,
	startsLine,
} from './layout';
import { validValue } from './refuse';
import {
	noop,
	refused,
	type EditContext,
	type EditOp,
	type IntentOf,
	type IntentPlan,
	type Refused,
	type SourceRange,
} from './types';
import { printValue, type TypedValue } from '../values';

const GAP: Readonly<Record<string, 'gapduration' | 'gaplength'>> = {
	GapdurationStatement: 'gapduration',
	GaplengthStatement: 'gaplength',
};

const span = (n: { from: number; to: number }): { from: number; to: number } => ({
	from: n.from,
	to: n.to,
});

/** A statement added to an item body, or a new body after the reference (module comment). */
function addToBody(file: TjpFile, item: SyntaxNode, body: SyntaxNode | null, stmt: string): EditOp {
	const text = fileText(file);
	const op = (at: number, before: string, after: string): EditOp => ({
		file: file.path,
		from: at,
		to: at,
		insert: before + stmt + after,
		element: span(item),
		select: { from: before.length, to: before.length + stmt.length },
	});
	if (!body) return op(item.to, ' { ', ' }');
	const close = body.lastChild;
	const open = body.firstChild;
	if (!close || close.name !== 'CloseBrace' || !open) return op(item.to, ' { ', ' }');
	if (lineStart(text, open.from) === lineStart(text, close.from) || !startsLine(text, close.from)) {
		return op(close.from, isBlankChar(text[close.from - 1]) ? '' : ' ', ' ');
	}
	const own = statementsIn(body).find((s) => startsLine(text, s.from));
	const indent = own ? lineIndent(text, own.from) : lineIndent(text, close.from) + indentUnit(file);
	return op(lineStart(text, close.from), indent, lineBreakNear(text, close.from));
}

/** The ops that give one item exactly the gap `gap` (module comment). */
function itemOps(
	file: TjpFile,
	item: SyntaxNode,
	gap: { kind: 'gapduration' | 'gaplength'; value: TypedValue; text: string } | null,
): EditOp[] | Refused {
	const body = item.getChild('Body');
	const stmts = body ? statementsIn(body) : [];
	const gaps = stmts.filter((s) => GAP[s.name] !== undefined);
	const sameKind = gaps.filter((s) => GAP[s.name] === gap?.kind);
	const keep = gap ? (sameKind[sameKind.length - 1] ?? gaps[gaps.length - 1] ?? null) : null;
	const ops: EditOp[] = [];
	if (gap && keep) {
		if (GAP[keep.name] === gap.kind) {
			const head = keep.getChild('Keyword');
			const valueFrom = head?.nextSibling?.from ?? keep.to;
			const r = replaceValue(file, { from: valueFrom, to: keep.to }, gap.value);
			if ('status' in r) {
				if (r.status === 'refused') return r;
			} else ops.push(r);
		} else ops.push(replaceSpan(file, span(keep), `${gap.kind} ${gap.text}`));
	} else if (gap) ops.push(addToBody(file, item, body, `${gap.kind} ${gap.text}`));
	const gone = gaps.filter((s) => s !== keep);
	if (gone.length === 0) return ops;
	const text = fileText(file);
	const open = body?.firstChild;
	const close = body?.lastChild;
	if (!gap && body && open && close) {
		let rest = text.slice(open.to, close.from);
		for (const s of [...gone].reverse()) {
			rest = rest.slice(0, s.from - open.to) + rest.slice(s.to - open.to);
		}
		if (isBlank(rest.replace(/[\r\n]/g, ''))) {
			let from = body.from;
			while (from > item.from && isBlankChar(text[from - 1])) from--;
			return [{ file: file.path, from, to: body.to, insert: '', element: span(item) }];
		}
	}
	return [
		...ops,
		...removeStatements(
			file,
			gone.map((s) => ({ stmt: span(s) })),
		),
	];
}

export function setDependsGapPlan(ctx: EditContext, intent: IntentOf<'setDependsGap'>): IntentPlan {
	const { index, ws } = ctx;
	const tasks = linkTasks(ctx, intent.task, intent.target);
	if ('status' in tasks) return tasks;
	const all = linkItems(index, tasks.succ.id, tasks.pred.id);
	const plain = all.filter((d) => unprefixed(index, d.scenario));
	const items = plain.length > 0 ? plain : all;
	if (items.length === 0) {
		return intent.gap === null
			? noop('not-present')
			: refused('unknown-target', [tasks.succ.decl.header, tasks.pred.decl.header]);
	}
	const ops: EditOp[] = [];
	for (const d of items) {
		const file = ws.files.get(d.item.file);
		const node = itemNode(ws, d.item.file, d.item);
		if (!file || !node) return refused('unknown-target', [d.item]);
		let gap = null;
		if (intent.gap) {
			const at: SourceRange = d.item;
			const v = validValue(ctx, intent.gap.kind, intent.gap.value.trim(), at);
			if ('status' in v) return v;
			const text = printValue(v);
			if (!text.ok) return refused('invalid-value', [at]);
			gap = { kind: intent.gap.kind, value: v, text: text.value };
		}
		const r = itemOps(file, node, gap);
		if ('status' in r) return r;
		ops.push(...r);
	}
	return ops.length > 0 ? ops : noop(intent.gap ? 'already-set' : 'not-present');
}
