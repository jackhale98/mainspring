// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { textOf } from '../tjp/document';
import { changesInside, lineMap, wholeLine } from './run-lines';
import { createWorkspace, type Workspace, type WorkspaceSnapshot } from './workspace';

const TEXT = 'line one\nline two\nline three\nline four\n';

function edit(ws: Workspace, from: number, to: number, insert: string, path = 'a.tjp'): void {
	const state = ws.state(path);
	ws.commit(path, state.update({ changes: { from, to, insert } }), 'typing');
}

/** Maps every line of the sent text after `change` ran on a workspace holding `text`. */
function mapped(text: string, change: (ws: Workspace) => void): Array<number | null> {
	const ws = createWorkspace({ entry: 'a.tjp', files: { 'a.tjp': text } });
	const sent = ws.snapshot();
	change(ws);
	const map = lineMap(sent, ws.snapshot(), ws.changesSince(sent.version));
	const count = text.split('\n').length;
	return Array.from({ length: count }, (_, i) => map.mapLine('a.tjp', i + 1));
}

describe('changesInside', () => {
	it('finds a change of a character or an insertion strictly inside', () => {
		const ranges = [
			{ fromA: 5, toA: 5 },
			{ fromA: 10, toA: 12 },
		];
		expect(changesInside([], 0, 100)).toBe(false);
		expect(changesInside(ranges, 0, 4)).toBe(false);
		expect(changesInside(ranges, 0, 5)).toBe(false);
		expect(changesInside(ranges, 4, 6)).toBe(true);
		expect(changesInside(ranges, 5, 9)).toBe(false);
		expect(changesInside(ranges, 6, 10)).toBe(false);
		expect(changesInside(ranges, 6, 11)).toBe(true);
		expect(changesInside(ranges, 11, 20)).toBe(true);
		expect(changesInside(ranges, 12, 20)).toBe(false);
	});
});

describe('wholeLine', () => {
	it('needs a TaskJuggler line break or the file edge on both sides', () => {
		const doc = textOf('ab\ncd\r\nef\rgh');
		expect(wholeLine(doc, 0, 2)).toBe(true);
		expect(wholeLine(doc, 3, 5)).toBe(true);
		expect(wholeLine(doc, 7, 9)).toBe(true);
		expect(wholeLine(doc, 10, 12)).toBe(true);
		expect(wholeLine(doc, 0, 1)).toBe(false);
		expect(wholeLine(doc, 1, 2)).toBe(false);
		// Between the \r and \n of a CRLF is no line start.
		expect(wholeLine(doc, 6, 6)).toBe(false);
		expect(wholeLine(doc, 3, 2)).toBe(false);
	});
});

describe('lineMap', () => {
	it('is the identity without changes, with the sent line as fingerprint', () => {
		const ws = createWorkspace({ entry: 'a.tjp', files: { 'a.tjp': TEXT } });
		const s = ws.snapshot();
		const map = lineMap(s, s, new Map());
		expect([1, 2, 3, 4, 5].map((l) => map.mapLine('a.tjp', l))).toEqual([1, 2, 3, 4, 5]);
		expect(map.sentLine('a.tjp', 2)).toBe('line two');
		expect(map.mapLine('a.tjp', 0)).toBeNull();
		expect(map.mapLine('a.tjp', 6)).toBeNull();
		expect(map.sentLine('a.tjp', 6)).toBeNull();
		expect(map.mapLine('b.tjp', 1)).toBeNull();
		expect(map.sentLine('b.tjp', 1)).toBeNull();
	});

	it('keeps lines next to inserted or deleted lines, shifted', () => {
		// A new line typed at the end of line 1: "line one" + "\nnew".
		expect(mapped(TEXT, (ws) => edit(ws, 8, 8, '\nnew'))).toEqual([1, 3, 4, 5, 6]);
		// A whole line inserted before line 2 (after the break of line 1).
		expect(mapped(TEXT, (ws) => edit(ws, 9, 9, 'new\n'))).toEqual([1, 3, 4, 5, 6]);
		// Enter at the start and at the end of line 2.
		expect(mapped(TEXT, (ws) => edit(ws, 9, 9, '\n'))).toEqual([1, 3, 4, 5, 6]);
		expect(mapped(TEXT, (ws) => edit(ws, 17, 17, '\n'))).toEqual([1, 2, 4, 5, 6]);
		// Line 2 deleted with its break.
		expect(mapped(TEXT, (ws) => edit(ws, 9, 18, ''))).toEqual([1, null, 2, 3, 4]);
	});

	it('drops a line changed inside, at either end, split or joined', () => {
		expect(mapped(TEXT, (ws) => edit(ws, 11, 12, 'X'))).toEqual([1, null, 3, 4, 5]);
		expect(mapped(TEXT, (ws) => edit(ws, 9, 9, '!'))).toEqual([1, null, 3, 4, 5]);
		expect(mapped(TEXT, (ws) => edit(ws, 17, 17, '!'))).toEqual([1, null, 3, 4, 5]);
		expect(mapped(TEXT, (ws) => edit(ws, 13, 13, '\n'))).toEqual([1, null, 4, 5, 6]);
		// Joining lines 2 and 3 touches both.
		expect(mapped(TEXT, (ws) => edit(ws, 17, 18, ''))).toEqual([1, null, null, 3, 4]);
		// An empty line that gets text, or is joined to the line before.
		const empty = 'a\n\nb\n';
		expect(mapped(empty, (ws) => edit(ws, 2, 2, 'x'))).toEqual([1, null, 3, 4]);
		expect(mapped(empty, (ws) => edit(ws, 1, 2, ''))).toEqual([1, null, 2, 3]);
	});

	it('maps through several edits since the run', () => {
		const out = mapped(TEXT, (ws) => {
			edit(ws, 0, 0, '# top\n');
			edit(ws, 0, 0, '# top again\n');
			const doc = ws.state('a.tjp').doc;
			const four = doc.line(6);
			edit(ws, four.from, four.to, 'line 4');
		});
		expect(out).toEqual([3, 4, 5, null, 7]);
	});

	it('reads TaskJuggler lines: CRLF and lone CR', () => {
		const crlf = 'a\r\nb\r\nc\r\n';
		expect(mapped(crlf, (ws) => edit(ws, 0, 0, 'x\r\n'))).toEqual([2, 3, 4, 5]);
		const ws = createWorkspace({ entry: 'a.tjp', files: { 'a.tjp': crlf } });
		const s = ws.snapshot();
		// The fingerprint is the CodeMirror line, as the index compares it (index/hints.ts).
		expect(lineMap(s, s, new Map()).sentLine('a.tjp', 2)).toBe('b\r');
		// A lone CR ends a TaskJuggler line inside one CodeMirror line.
		const cr = createWorkspace({ entry: 'a.tjp', files: { 'a.tjp': 'a\rb\nc\n' } }).snapshot();
		const map = lineMap(cr, cr, new Map());
		expect([1, 2, 3].map((l) => map.mapLine('a.tjp', l))).toEqual([1, 1, 2]);
		expect(map.sentLine('a.tjp', 2)).toBe('a\rb');
	});

	it('gives nothing for a change map that does not fit the texts', () => {
		const ws = createWorkspace({ entry: 'a.tjp', files: { 'a.tjp': TEXT, 'b.tji': 'x\n' } });
		const sent = ws.snapshot();
		edit(ws, 0, 0, 'more\n');
		const now: WorkspaceSnapshot = ws.snapshot();
		expect(lineMap(sent, now, new Map()).mapLine('a.tjp', 1)).toBeNull();
		const other = ws.changesSince(sent.version).get('a.tjp');
		if (!other) throw new Error('no change');
		expect(lineMap(sent, now, new Map([['b.tji', other]])).mapLine('b.tji', 1)).toBeNull();
		const gone = { files: new Map() };
		expect(lineMap(sent, gone, new Map()).mapLine('a.tjp', 1)).toBeNull();
	});
});
