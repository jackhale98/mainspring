// SPDX-License-Identifier: GPL-2.0-or-later
// Corpora and tree helpers for the grammar tests beside src/lib/tjp/grammar (phase-1.md 5.5, 9.1).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Tree } from '@lezer/common';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function walk(dir: string, out: string[] = []): string[] {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) walk(p, out);
		else if (/\.tj[ip]$/.test(e.name)) out.push(p);
	}
	return out.sort();
}

const rel = (p: string): string => path.relative(ROOT, p).split(path.sep).join('/');

/** Files that must parse with error nodes, and the 1-based line of the first one. */
export const NEGATIVE: ReadonlyMap<string, number> = new Map([
	// Lines from each fixture's README row and golden message.
	['tests/fixtures/tjp/neg-unterminated-string/plan.tjp', 5],
	['tests/fixtures/tjp/neg-junk-after-cut/plan.tjp', 7],
	['engine/golden/plans/synthetic/19-errors-parse/lib/broken.tji', 6],
	['engine/golden/plans/bridge/parse-failure/plan.tjp', 14],
]);

export interface Corpus {
	readonly name: string;
	/** Paths relative to the repository root. */
	readonly files: readonly string[];
}

export const CORPORA: readonly Corpus[] = [
	{ name: 'fixtures', files: walk(path.join(ROOT, 'tests/fixtures/tjp')).map(rel) },
	{ name: 'golden plans', files: walk(path.join(ROOT, 'engine/golden/plans')).map(rel) },
	{ name: 'upstream examples', files: walk(path.join(ROOT, 'engine/tj/examples')).map(rel) },
	{
		name: 'Syntax/Correct',
		files: walk(path.join(ROOT, 'engine/tj/test/TestSuite/Syntax/Correct')).map(rel),
	},
];

/** A file's text, decoded as the app decodes it (ADR-0002 #13). */
export function readTjp(file: string): string {
	return new TextDecoder('utf-8', { ignoreBOM: true }).decode(
		fs.readFileSync(path.join(ROOT, file)),
	);
}

/** Leaf texts plus the gaps between them; throws if a gap holds anything but whitespace. */
export function printLeaves(tree: Tree, text: string): string {
	let out = '';
	let pos = 0;
	const gap = (to: number): void => {
		const g = text.slice(pos, to);
		if (!/^[ \t\n\v\f\r]*$/.test(g)) {
			throw new Error(`non-whitespace gap at ${pos}-${to}: ${JSON.stringify(g)}`);
		}
		out += g;
	};
	const cursor = tree.cursor();
	for (;;) {
		if (!cursor.firstChild()) {
			if (cursor.type.isTop) {
				gap(text.length);
				return out;
			}
			if (cursor.from < pos) throw new Error(`overlapping leaf at ${cursor.from}`);
			if (cursor.to > cursor.from || !cursor.type.isError) {
				gap(cursor.from);
				out += text.slice(cursor.from, cursor.to);
				pos = cursor.to;
			}
			for (;;) {
				if (cursor.nextSibling()) break;
				if (!cursor.parent()) {
					gap(text.length);
					return out;
				}
			}
		}
	}
}

export interface ErrorNode {
	from: number;
	to: number;
	line: number;
}

export function errorNodes(tree: Tree, text: string): ErrorNode[] {
	const out: ErrorNode[] = [];
	tree.iterate({
		enter(n) {
			if (n.type.isError) {
				out.push({ from: n.from, to: n.to, line: text.slice(0, n.from).split('\n').length });
			}
		},
	});
	return out;
}

/** Every node as `name:from-to`, in document order, for tree equality. */
export function serialize(tree: Tree): string[] {
	const out: string[] = [];
	tree.iterate({
		enter(n) {
			out.push(`${n.name}:${n.from}-${n.to}`);
		},
	});
	return out;
}
