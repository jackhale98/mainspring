// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { CORPORA, readTjp } from '../../../../tests/grammar/corpus';
import { parseTjp, textOf } from '../document';
import { ContextTracker } from '@lezer/lr';
import { readWord } from '../grammar/chars';
import { reduceFrame, shiftFrame, topFrame, type TjpFrame } from '../grammar/context';
import { resolveHeadKeyword } from '../grammar/keyword-extras';
import { tjpGlobalParser } from '../grammar/parser';
import { HEAD_KEYWORD_TERMS } from '../grammar/terms';
import { syntaxIssues } from '../tree';
import { PROLOG_CONTEXT, type TopContextName } from '../syntax/keywords';
import { contextAt, inOpaqueToken, keywordEntryOf, keywordNodeAt } from './context';
import { cursorDoc } from './testing';

function ctx(marked: string, top: TopContextName = 'global'): string | null {
	const { doc, pos } = cursorDoc(marked);
	return contextAt(parseTjp(doc, { top }), pos, top, (a, b) => doc.slice(a, b));
}

describe('contextAt', () => {
	it('is the top context at the top level', () => {
		expect(ctx('|project p "P" 2026-01-01 +1m')).toBe('');
		expect(ctx('task a "A" {\n}\n|')).toBe('');
		expect(ctx('|', 'prolog')).toBe(PROLOG_CONTEXT);
		expect(ctx('|', 'project')).toBe('project');
	});

	it('follows bodies', () => {
		expect(ctx('project p "P" 2026-01-01 +1m {\n  |\n}\n')).toBe('project');
		expect(ctx('task a "A" {\n  |\n}\n')).toBe('task');
		expect(ctx('task a "A" {\n  task b "B" {\n    |\n  }\n}\n')).toBe('task');
		expect(ctx('resource r "R" {\n  |\n}\n')).toBe('resource');
		expect(ctx('task a "A" {\n  limits { | }\n}\n')).toBe('limits.task');
		expect(ctx('resource r "R" {\n  limits { | }\n}\n')).toBe('limits.resource');
	});

	it('reads the subject of supplement and the item bodies of depends', () => {
		expect(ctx('supplement task a {\n  |\n}\n')).toBe('supplement.task');
		expect(ctx('supplement resource r {\n  |\n}\n')).toBe('supplement.resource');
		expect(ctx('task a "A" {\n  depends b { | }\n}\n')).toBe('depends');
	});

	it('is outside a body after its closing brace and inside an unclosed one', () => {
		expect(ctx('task a "A" {\n}|')).toBe('');
		expect(ctx('task a "A" {|\n}')).toBe('task');
		expect(ctx('task a "A" {\n  ef|')).toBe('task');
		expect(ctx('task a "A" {\n  plan:ef|\n}\n')).toBe('task');
	});

	it('is null in the body of an unknown statement', () => {
		expect(ctx('task a "A" {\n  Custom x {\n    |\n  }\n}\n')).toBeNull();
	});

	it('gives every keyword of the corpora the scoped keyword the grammar resolved', () => {
		let checked = 0;
		const mismatches: string[] = [];
		for (const corpus of CORPORA) {
			for (const file of corpus.files) checked += agree(readTjp(file), 'global', file, mismatches);
		}
		expect(mismatches).toEqual([]);
		expect(checked).toBeGreaterThan(5_000);
	});

	it('agrees with the grammar under the project and prolog tops', () => {
		const mismatches: string[] = [];
		const project = [
			'timezone "Europe/Berlin"',
			'scenario plan "Plan" {',
			'  scenario delayed "Delayed" { }',
			'}',
			'extend task {',
			'  text Phone "Phone"',
			'}',
			'workinghours mon - fri 9:00 - 17:00',
			'include "more.tji" { }',
			'',
		].join('\n');
		const prolog = 'macro m [ task x "X" ]\ninclude "macros.tji"\n';
		expect(agree(project, 'project', 'project', mismatches)).toBeGreaterThanOrEqual(6);
		expect(agree(prolog, 'prolog', 'prolog', mismatches)).toBe(2);
		// Corpus files that parse cleanly in the header context (included there).
		let inHeader = 0;
		for (const corpus of CORPORA) {
			for (const file of corpus.files) {
				const text = readTjp(file);
				if (syntaxIssues(parseTjp(text, { top: 'project' }), textOf(text)).length > 0) continue;
				inHeader += agree(text, 'project', file, mismatches);
			}
		}
		expect(mismatches).toEqual([]);
		expect(inHeader).toBeGreaterThan(0);
	});
});

/**
 * Parses `text` with a tracker that records, at each head-keyword token, the scoped keyword the
 * grammar's context resolved there; then checks `contextAt` resolves each `Keyword` node of the
 * tree to the same one. Returns how many keywords were compared; mismatches go to `out`.
 */
function agree(text: string, top: TopContextName, name: string, out: string[]): number {
	const recorded = new Map<number, string | null>();
	const tracker = new ContextTracker<TjpFrame>({
		start: topFrame(top),
		shift: (frame, term, _stack, input) => {
			if (HEAD_KEYWORD_TERMS.has(term) && frame.ctx !== null) {
				const word = readWord((i) => input.peek(i), 0);
				recorded.set(input.pos, resolveHeadKeyword(word, frame.ctx)?.keyword ?? null);
			}
			return shiftFrame(frame, term, input, 0);
		},
		reduce: (frame, term) => reduceFrame(frame, term),
		hash: (frame) => frame.hash,
		strict: true,
	});
	const tree = tjpGlobalParser.configure({ contextTracker: tracker }).parse(text);
	const read = (a: number, b: number): string => text.slice(a, b);
	let n = 0;
	tree.iterate({
		enter(node) {
			if (node.name !== 'Keyword') return;
			const want = recorded.get(node.from);
			const c = contextAt(tree, node.from, top, read);
			const have =
				c === null ? null : (resolveHeadKeyword(read(node.from, node.to), c)?.keyword ?? null);
			if (want === undefined || have !== want) {
				if (out.length < 10) out.push(`${name}@${node.from}: ${String(have)} vs ${String(want)}`);
			}
			n++;
		},
	});
	return n;
}

describe('keywordEntryOf', () => {
	it('resolves a keyword in its statement context', () => {
		const doc = 'resource r "R" {\n  booking t 2026-01-05 +1d\n}\ntask t "T" {\n  effort 1d\n}\n';
		const tree = parseTjp(doc);
		const read = (a: number, b: number): string => doc.slice(a, b);
		const at = (word: string): string | null => {
			const node = keywordNodeAt(tree, doc.indexOf(word) + 1);
			return node ? (keywordEntryOf(tree, node, 'global', read)?.keyword ?? null) : null;
		};
		expect(at('booking')).toBe('booking.resource');
		expect(at('effort')).toBe('effort');
		expect(at('resource')).toBe('resource');
	});
});

describe('inOpaqueToken', () => {
	const doc = 'task a "A b" { # note\n  /* block */ effort 1d\n}\nmacro m [ x ]\n';
	const tree = parseTjp(doc);
	it('is true inside strings, comments and macro bodies', () => {
		expect(inOpaqueToken(tree, doc.indexOf('A b') + 1)).toBe(true);
		expect(inOpaqueToken(tree, doc.indexOf('note'))).toBe(true);
		expect(inOpaqueToken(tree, doc.indexOf('# note') + 6)).toBe(true);
		expect(inOpaqueToken(tree, doc.indexOf('block'))).toBe(true);
		expect(inOpaqueToken(tree, doc.indexOf(' x '))).toBe(true);
	});
	it('is false between tokens and at token edges', () => {
		expect(inOpaqueToken(tree, doc.indexOf('effort'))).toBe(false);
		expect(inOpaqueToken(tree, doc.indexOf('"A b"'))).toBe(false);
		expect(inOpaqueToken(tree, doc.indexOf('*/') + 2)).toBe(false);
	});
});
