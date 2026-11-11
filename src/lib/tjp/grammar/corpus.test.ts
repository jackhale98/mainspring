// SPDX-License-Identifier: GPL-2.0-or-later
// The grammar on every corpus file (phase-1.md 5.5, 9.1): no error nodes in valid files, leaves
// plus whitespace print the input, and MVP keywords parse as typed statements. Negative files put
// their first error node on the line TaskJuggler reports.
import fs from 'node:fs';
import path from 'node:path';
import type { SyntaxNode, Tree } from '@lezer/common';
import { describe, expect, it } from 'vitest';
import {
	CORPORA,
	NEGATIVE,
	ROOT,
	errorNodes,
	printLeaves,
	readTjp,
} from '../../../../tests/grammar/corpus';
import { GLOBAL_CONTEXT, isContext, type ContextId } from '../syntax/keywords';
import { headBodyContext, resolveHeadKeyword } from './keyword-extras';
import { OPAQUE_STATEMENTS, TYPED_STATEMENTS, tjpParser, typedStatementOf } from './parser';
import { tokenizeTjp, isTrivia } from './tokens';

const parser = tjpParser('global');
const parsed = new Map<string, { text: string; tree: Tree }>();
function parse(file: string): { text: string; tree: Tree } {
	let p = parsed.get(file);
	if (!p) {
		const text = readTjp(file);
		p = { text, tree: parser.parse(text) };
		parsed.set(file, p);
	}
	return p;
}

/** The statement's head: its first child after an optional scenario prefix. */
function head(stmt: SyntaxNode): SyntaxNode | null {
	let c = stmt.firstChild;
	if (c?.name === 'ScenarioPrefix') c = c.nextSibling;
	return c;
}

interface Typing {
	typed: Map<string, number>;
	opaque: number;
	problems: string[];
	/** Keyword leaves by start offset, with their statement. */
	keywords: Map<number, SyntaxNode>;
}

/**
 * Walks the statements with the contexts the tree implies (a statement's keyword decides its
 * body's context), checking each keyword head against the keyword table: typed keywords must
 * have their typed statement, the others an opaque one.
 */
function typing(tree: Tree, text: string): Typing {
	const out: Typing = { typed: new Map(), opaque: 0, problems: [], keywords: new Map() };
	const visit = (parent: SyntaxNode, ctx: ContextId | null): void => {
		for (let s = parent.firstChild; s; s = s.nextSibling) {
			if (!s.name.endsWith('Statement')) continue;
			const h = head(s);
			let bodyCtx: ContextId | null = null;
			if (OPAQUE_STATEMENTS.has(s.name)) out.opaque++;
			else out.typed.set(s.name, (out.typed.get(s.name) ?? 0) + 1);
			if (h?.name === 'Keyword') {
				out.keywords.set(h.from, s);
				const word = text.slice(h.from, h.to);
				const entry = ctx === null ? null : resolveHeadKeyword(word, ctx);
				if (!entry) {
					out.problems.push(`${word}@${h.from}: keyword not valid in '${ctx}'`);
				} else {
					const want = typedStatementOf(entry.keyword) ?? 'OpaqueStatement';
					if (s.name !== want) out.problems.push(`${word}@${h.from}: ${s.name}, want ${want}`);
					const spec = specStatement(word, ctx);
					if (spec && s.name !== spec) {
						out.problems.push(`${word}@${h.from} in '${ctx}': ${s.name}, spec 5.3 wants ${spec}`);
					}
					const kind = s.getChild('SupplementKind');
					const subject = kind ? text.slice(kind.from, kind.to) : undefined;
					bodyCtx = headBodyContext(entry, subject);
					if (bodyCtx === null && subject !== undefined && isContext(subject)) bodyCtx = subject;
				}
			} else if (h && !OPAQUE_STATEMENTS.has(s.name)) {
				out.problems.push(`${s.name}@${s.from}: typed statement without a keyword`);
			}
			// Bodies of the statement and of its items (DepItem, AllocItem, …).
			const bodies: SyntaxNode[] = [];
			for (let c = s.firstChild; c; c = c.nextSibling) {
				if (c.name === 'Body') bodies.push(c);
				else for (const b of c.getChildren('Body')) bodies.push(b);
			}
			for (const b of bodies) visit(b, bodyCtx);
		}
	};
	visit(tree.topNode, GLOBAL_CONTEXT);
	return out;
}

/**
 * Spec 5.3, written out independently of terms.ts: the contexts where each MVP keyword must have
 * its typed statement (`<Name>Statement`). Prolog and supplement bodies count as their kind.
 */
const SPEC_5_3: Readonly<Record<string, readonly string[]>> = {
	'': [
		'project',
		'include',
		'macro',
		'flags',
		'leaves',
		'vacation',
		'task',
		'resource',
		'supplement',
	],
	'<prolog>': ['include', 'macro'],
	project: [
		'timezone',
		'timeformat',
		'currency',
		'now',
		'dailyworkinghours',
		'weekstartsmonday',
		'workinghours',
		'include',
	],
	task: [
		'task',
		'effort',
		'length',
		'duration',
		'start',
		'end',
		'minstart',
		'maxend',
		'scheduling',
		'milestone',
		'priority',
		'complete',
		'note',
		'flags',
		'responsible',
		'depends',
		'precedes',
		'allocate',
		'supplement',
	],
	resource: [
		'resource',
		'vacation',
		'workinghours',
		'efficiency',
		'rate',
		'email',
		'managers',
		'leaves',
		'supplement',
	],
	depends: ['gapduration', 'gaplength', 'onstart', 'onend'],
	precedes: ['gapduration', 'gaplength', 'onstart', 'onend'],
};

function specStatement(word: string, ctx: ContextId | null): string | null {
	if (ctx === null) return null;
	const key = ctx === 'supplement.task' ? 'task' : ctx === 'supplement.resource' ? 'resource' : ctx;
	if (!SPEC_5_3[key]?.includes(word)) return null;
	return `${word.charAt(0).toUpperCase()}${word.slice(1)}Statement`;
}

describe.each(CORPORA)('$name', ({ files }) => {
	const valid = files.filter((f) => !NEGATIVE.has(f));

	it('is not empty', () => {
		expect(valid.length).toBeGreaterThan(0);
	});

	it.each(valid)('%s parses with no error nodes and prints back exactly', (file) => {
		const { text, tree } = parse(file);
		expect(errorNodes(tree, text)).toEqual([]);
		expect(tree.length).toBe(text.length);
		expect(printLeaves(tree, text)).toBe(text);
	});

	it.each(valid)('%s: every keyword head has its typed or opaque statement', (file) => {
		const { text, tree } = parse(file);
		expect(typing(tree, text).problems).toEqual([]);
	});

	it.each(valid)('%s: statement words that start a line are typed keyword heads', (file) => {
		// Token-level oracle: an identifier spelled like an MVP keyword that starts its line (and
		// does not continue a `,` list) heads a statement, so the tree must have a Keyword there.
		const { text, tree } = parse(file);
		const { keywords } = typing(tree, text);
		const problems: string[] = [];
		let prev: string | null = null;
		let lineStart = true;
		for (const t of tokenizeTjp(text)) {
			if (isTrivia(t.kind)) {
				if (text.slice(t.from, t.to).includes('\n')) lineStart = true;
				continue;
			}
			const word = text.slice(t.from, t.to);
			if (t.kind === 'Identifier' && lineStart && prev !== ',' && MVP_WORDS.has(word)) {
				const stmt = keywords.get(t.from);
				if (!stmt) problems.push(`${word}@${t.from} is not a keyword head`);
			}
			prev = word;
			lineStart = false;
		}
		expect(problems).toEqual([]);
	});
});

/** Names of keywords with typed statements in some context. */
const MVP_WORDS: ReadonlySet<string> = new Set([
	'project',
	'include',
	'macro',
	'flags',
	'leaves',
	'vacation',
	'timezone',
	'timeformat',
	'currency',
	'now',
	'dailyworkinghours',
	'weekstartsmonday',
	'workinghours',
	'task',
	'effort',
	'length',
	'duration',
	'start',
	'end',
	'minstart',
	'maxend',
	'scheduling',
	'milestone',
	'priority',
	'complete',
	'note',
	'responsible',
	'depends',
	'precedes',
	'gapduration',
	'gaplength',
	'onstart',
	'onend',
	'allocate',
	'resource',
	'efficiency',
	'rate',
	'email',
	'managers',
	'supplement',
]);

describe('negative files', () => {
	it.each([...NEGATIVE])('%s has its first error node on line %i', (file, line) => {
		const { text, tree } = parse(file);
		const errors = errorNodes(tree, text);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors[0]?.line).toBe(line);
		// Still lossless.
		expect(printLeaves(tree, text)).toBe(text);
	});
});

interface GoldenProperty {
	id: string;
	source: { file: string; line: number } | null;
}
interface Golden {
	id: string;
	files: string[];
	result: { tasks: GoldenProperty[]; resources: GoldenProperty[] };
}
interface ManifestEntry {
	id: string;
	root: string;
}

describe('golden tasks and resources', () => {
	// Independent oracle: TaskJuggler's own source line for each task and resource. Each one
	// declared by literal text must be a TaskStatement or ResourceStatement whose keyword is on
	// that line; the rest come from macro expansion (a macro call on the line, or a macro body).
	const manifest = JSON.parse(
		fs.readFileSync(path.join(ROOT, 'engine/golden/manifest.json'), 'utf8'),
	) as ManifestEntry[];
	const counts = { typed: 0, expanded: 0 };

	it.each(manifest.map((m) => [m.id, m.root] as const))('%s', (id, root) => {
		const golden = JSON.parse(
			fs.readFileSync(path.join(ROOT, `engine/golden/expected/${id}.json`), 'utf8'),
		) as Golden;
		const problems: string[] = [];
		const check = (list: GoldenProperty[], statement: string): void => {
			for (const p of list) {
				if (!p.source) continue;
				const file = `${root}/${p.source.file}`;
				const { text, tree } = parse(file);
				const lineFrom = lineOffset(text, p.source.line);
				const lineTo = text.indexOf('\n', lineFrom);
				let found = false;
				let macro = false;
				tree.iterate({
					from: lineFrom,
					to: lineTo < 0 ? text.length : lineTo,
					enter(n) {
						if (n.name === statement) {
							const h = head(n.node);
							if (h?.name === 'Keyword' && h.from >= lineFrom && h.from <= lineTo) found = true;
						}
						if (n.name === 'MacroCall' || n.name === 'MacroWord' || n.name === 'MacroBody') {
							macro = true;
						}
					},
				});
				if (found) counts.typed++;
				else if (macro) counts.expanded++;
				else problems.push(`${p.id} at ${file}:${p.source.line} is not a typed ${statement}`);
			}
		};
		check(golden.result.tasks, 'TaskStatement');
		check(golden.result.resources, 'ResourceStatement');
		expect(problems).toEqual([]);
	});

	it('reports the counts', () => {
		console.info(
			`golden tasks and resources: ${counts.typed} typed declarations, ` +
				`${counts.expanded} from macro expansion`,
		);
		expect(counts.typed).toBeGreaterThan(1000);
	});
});

function lineOffset(text: string, line: number): number {
	let pos = 0;
	for (let i = 1; i < line; i++) pos = text.indexOf('\n', pos) + 1;
	return pos;
}

describe('coverage report', () => {
	it('lists typed and opaque statements per corpus', () => {
		const lines: string[] = [];
		for (const { name, files } of CORPORA) {
			const totals = new Map<string, number>();
			let opaque = 0;
			let typedTotal = 0;
			for (const f of files) {
				if (NEGATIVE.has(f)) continue;
				const { text, tree } = parse(f);
				const t = typing(tree, text);
				opaque += t.opaque;
				for (const [k, v] of t.typed) {
					totals.set(k, (totals.get(k) ?? 0) + v);
					typedTotal += v;
				}
			}
			const top = ['Task', 'Resource', 'Effort', 'Depends', 'Allocate']
				.map((k) => `${k} ${totals.get(`${k}Statement`) ?? 0}`)
				.join(', ');
			lines.push(`${name}: ${files.length} files, ${typedTotal} typed (${top}), ${opaque} opaque`);
			for (const k of totals.keys()) expect(TYPED_STATEMENTS.has(k)).toBe(true);
		}
		console.info(lines.join('\n'));
	});
});
