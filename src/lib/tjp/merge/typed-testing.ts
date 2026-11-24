// SPDX-License-Identifier: GPL-2.0-or-later
// Statements typed into one block by both sides, for the engine merge property (review round 3):
// task values (`priority`, `complete`, `note`), `workinghours` of a resource or the project, often
// for the same weekday (N1), and `purge allocate` against a new allocation (N2), in blocks laid
// out the ways plans write them: as generated, on one line (N3), with `{` on its own line (N3) or
// as a task without an id (N4). Besides the sides, a case carries `orders`: the base with both
// sides' statements at the end of the block, ours first and theirs first. A clean merge claims the
// two edits are independent, so the two orders must schedule alike; when they do not, the merge
// had to conflict. That is what catches a weekday or a purge merged as if it were additive.
import { mixSeed, Rng } from '../../../../tests/fidelity/gen/rng';
import type { BodyF, TaskF } from '../../../../tests/fidelity/gen/facts';
import type { EditIntent } from '../edit/types';
import { planOf, type TwoSides } from './sides-testing';

type Files = Record<string, string>;

export interface TypedSides extends TwoSides {
	/** What was typed, for messages. */
	readonly what: string;
	/** The statements each side typed, and the layout of the block. */
	readonly typed: readonly [readonly string[], readonly string[]];
	readonly layout: string;
	/** The base with ours' then theirs' statements at the end of the block, and theirs' first. */
	readonly orders: readonly [Files, Files];
}

interface Target {
	readonly file: string;
	readonly text: string;
	readonly open: number;
	readonly close: number;
	readonly layout: string;
	/** Line ends (offsets of `\n`) in the body's own lines, after `{` or after one of its elements. */
	readonly ends: readonly number[];
	/** The indentation of the body's statements. */
	readonly indent: string;
}

/** `g` with the line ends of its own lines, from the body's elements shifted by `d`. */
function lined(g: Omit<Target, 'ends' | 'indent'>, body: BodyF, d: number): Target {
	const { text, open, close } = g;
	const ends = new Set<number>();
	for (const at of [open, ...body.elems.map((e) => e.to + d)]) {
		const nl = text.indexOf('\n', at);
		if (nl >= 0 && nl < close) ends.add(nl);
	}
	const first = body.elems[0];
	const lineOf = (x: number): string => text.slice(text.lastIndexOf('\n', x - 1) + 1, x);
	const closing = /^[ \t]*/.exec(lineOf(close))?.[0] ?? '';
	const own = first ? /^[ \t]*/.exec(lineOf(first.from + d))?.[0] : undefined;
	const indent =
		own && own.length > closing.length ? own : `${closing}${closing.includes('\t') ? '\t' : '  '}`;
	return { ...g, ends: [...ends].sort((x, y) => x - y), indent };
}

const word = (id: string): RegExp =>
	new RegExp(`(^|[^\\w.])${id.replace(/\./g, '\\.')}(?![\\w])`, 'g');

/** The body of `t` in one of the layouts, rewritten in the base text, or null. */
function laidOut(files: Files, t: TaskF, body: BodyF, kind: 'task' | 'other', rng: Rng): Target {
	const text = files[body.file] ?? '';
	const inner = text.slice(body.open, body.close);
	const plain = lined(
		{ file: body.file, text, open: body.open, close: body.close, layout: 'as written' },
		body,
		0,
	);
	const pick = rng.int(0, 3);
	if (pick === 1 && !/[{}#"\\$[]|\/\*|\/\/|-8<-/.test(inner)) {
		const one = inner
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter(Boolean)
			.join(' ');
		const body2 = one ? ` ${one} ` : ' ';
		return {
			file: body.file,
			text: `${text.slice(0, body.open)}${body2}${text.slice(body.close)}`,
			open: body.open,
			close: body.open + body2.length,
			layout: 'one line',
			ends: [],
			indent: '',
		};
	}
	if (pick === 2 && text[body.open - 1] === '{') {
		const lineStart = text.lastIndexOf('\n', body.open - 1) + 1;
		const indent = /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? '';
		const head = text.slice(0, body.open - 1).trimEnd();
		const nl = text.includes('\r\n') ? '\r\n' : '\n';
		const moved = `${head}${nl}${indent}{`;
		const d = moved.length - body.open;
		return lined(
			{
				file: body.file,
				text: `${moved}${text.slice(body.open)}`,
				open: body.open + d,
				close: body.close + d,
				layout: '{ on its own line',
			},
			body,
			d,
		);
	}
	if (pick === 3 && kind === 'task' && t.children.length === 0) {
		const local = t.id.split('.').pop() ?? t.id;
		const head = /^task\s+([A-Za-z_]\w*)\s+/.exec(text.slice(t.block.from));
		const uses = Object.values(files).reduce((n, f) => n + (f.match(word(local))?.length ?? 0), 0);
		if (head && head[1] === local && uses === 1) {
			const cut = head[0].length - 'task '.length;
			const at = t.block.from + 'task '.length;
			return lined(
				{
					file: body.file,
					text: `${text.slice(0, at)}${text.slice(at + cut)}`,
					open: body.open - cut,
					close: body.close - cut,
					layout: 'no id',
				},
				body,
				-cut,
			);
		}
	}
	return plain;
}

/** `stmts` typed into the body at a random line of it (or after `{` or before `}` on one line). */
function typedAt(g: Target, stmts: readonly string[], rng: Rng): string {
	const { text, open, close, ends, indent } = g;
	if (ends.length === 0) {
		const at = rng.chance(0.5) ? open : close;
		return `${text.slice(0, at)} ${stmts.join(' ')} ${text.slice(at)}`;
	}
	const at = ends[rng.int(0, ends.length - 1)] as number;
	const cr = text[at - 1] === '\r' ? 1 : 0;
	const nl = cr ? '\r\n' : '\n';
	const lines = stmts.map((s) => `${nl}${indent}${s}`).join('');
	return `${text.slice(0, at - cr)}${lines}${text.slice(at - cr)}`;
}

/** The base with `first` then `second` at the end of the block. */
const atEnd = (g: Target, first: readonly string[], second: readonly string[]): string =>
	`${g.text.slice(0, g.close)}\n${[...first, ...second].join('\n')}\n${g.text.slice(g.close)}`;

/** Both sides type into one block; null when the plan has no fitting block. */
export function typedSides(seed: number): TypedSides | null {
	const p = planOf(seed);
	const rng = new Rng(mixSeed(seed, 0x7e3d));
	const f = p.c.facts;
	const files: Files = { ...p.files };
	const kind = rng.int(0, 3);
	const day = (): string => (rng.chance(0.6) ? 'mon' : 'tue');
	const hours = (): string => (rng.chance(0.5) ? '9:00 - 12:00' : '13:00 - 17:00');
	let owner: TaskF | null = null;
	let a: string[] = [];
	let b: string[] = [];
	if (kind === 1 || kind === 3) {
		const pool = kind === 3 && f.project?.body ? [f.project] : f.resTree.filter((r) => r.body);
		owner = pool[rng.int(0, pool.length - 1)] ?? null;
		a = [`workinghours ${day()} ${hours()}`];
		b = [`workinghours ${day()} ${hours()}`];
	} else if (kind === 2 && f.resTree.length > 1) {
		const pool = f.tasks.filter(
			(t) =>
				t.body && !t.nameMacro && t.stmts.some((s) => s.key === 'allocate' && s.site === 'decl'),
		);
		owner = pool[rng.int(0, pool.length - 1)] ?? null;
		const leaves = f.resTree.filter((r) => r.children.length === 0).map((r) => r.id);
		const res = (): string => leaves[rng.int(0, leaves.length - 1)] ?? '';
		a = ['purge allocate', `allocate ${res()}`];
		b = [`allocate ${res()}`];
	} else {
		const pool = f.tasks.filter((t) => t.body && !t.nameMacro);
		owner = pool[rng.int(0, pool.length - 1)] ?? null;
		const value = (): string =>
			[
				`priority ${rng.int(1, 999)}`,
				`complete ${rng.int(0, 100)}`,
				`note "typed ${rng.int(0, 99)}"`,
			][rng.int(0, 2)] ?? '';
		[a, b] = [[value()], [value()]];
		const own = new Set(owner?.stmts.map((s) => s.key));
		if ([...a, ...b].some((s) => own.has(s.split(' ')[0] ?? ''))) return null;
	}
	const body = owner?.body;
	if (!owner || !body || a.some((s) => s.endsWith(' ')) || b.some((s) => s.endsWith(' ')))
		return null;
	const g = laidOut(files, owner, body, kind === 0 || kind === 2 ? 'task' : 'other', rng);
	const base = { ...files, [g.file]: g.text };
	const side = (stmts: string[]): { intent: EditIntent; files: Files; changes: null } => ({
		intent: { type: 'setAttr', task: owner?.id ?? '', attr: 'note', value: stmts.join('; ') },
		files: { ...base, [g.file]: typedAt(g, stmts, rng) },
		changes: null,
	});
	return {
		p: { ...p, files: base },
		a: side(a),
		b: side(b),
		what: `${owner.id} (${g.layout}): ${a.join('; ')} / ${b.join('; ')}`,
		typed: [a, b],
		layout: g.layout,
		orders: [
			{ ...base, [g.file]: atEnd(g, a, b) },
			{ ...base, [g.file]: atEnd(g, b, a) },
		],
	};
}
