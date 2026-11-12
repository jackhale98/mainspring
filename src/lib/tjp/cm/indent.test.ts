// SPDX-License-Identifier: GPL-2.0-or-later
import { insertNewlineAndIndent } from '@codemirror/commands';
import { getIndentation, getIndentUnit, IndentContext } from '@codemirror/language';
import { countColumn, type EditorState, type Transaction } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { CORPORA, NEGATIVE, readTjp } from '../../../../tests/grammar/corpus';
import { changeSetOf, createFile, textOf, updateFile } from '../document';
import { analyzeLines, detectIndentUnit, formatFile } from '../format';
import { syntaxIssues } from '../tree';
import { enterInString, inQuotedString, textIndentUnit } from './indent';
import { tjpState } from './testing';

/**
 * The document after pressing Enter at the cursor, with `|` at the new cursor: the TJP keymap's
 * Enter (inside quoted strings) first, then the default keymap's insertNewlineAndIndent.
 */
function enter(marked: string): string {
	let state: EditorState = tjpState(marked);
	const target = {
		state,
		dispatch: (tr: Transaction) => {
			state = tr.state;
		},
	};
	if (!enterInString(target)) insertNewlineAndIndent(target);
	const head = state.selection.main.head;
	const doc = state.doc.toString();
	return `${doc.slice(0, head)}|${doc.slice(head)}`;
}

describe('indentation on Enter', () => {
	it('indents a body by the unit and nested bodies by depth', () => {
		expect(enter('task a "A" {|\n}\n')).toBe('task a "A" {\n  |\n}\n');
		expect(enter('task a "A" {|}\n')).toBe('task a "A" {\n  |\n}\n');
		expect(enter('task a "A" {\n  task b "B" {|\n  }\n}\n')).toBe(
			'task a "A" {\n  task b "B" {\n    |\n  }\n}\n',
		);
		expect(enter('task a "A" {\n  effort 5d|\n}\n')).toBe('task a "A" {\n  effort 5d\n  |\n}\n');
	});

	it('continues a list after a trailing comma, and a statement split in the middle', () => {
		expect(enter('task a "A" {\n  depends b,|\n}\n')).toBe(
			'task a "A" {\n  depends b,\n    |\n}\n',
		);
		expect(enter('task a "A" {\n  depends b, # more\n|}\n')).toContain('depends b, # more\n');
		expect(enter('task a "A" {\n  effort| 5d\n}\n')).toBe('task a "A" {\n  effort\n    |5d\n}\n');
	});

	it('puts a closing brace at the header level', () => {
		expect(enter('task a "A" {\n  effort 5d|}\n')).toBe('task a "A" {\n  effort 5d\n|}\n');
	});

	it('inserts a bare line break inside quoted strings, keeping the value', () => {
		expect(enter('task a "A" {\n  note "one|   two"\n}\n')).toBe(
			'task a "A" {\n  note "one\n|   two"\n}\n',
		);
		expect(enter("task a 'A|  B' {\n}\n")).toBe("task a 'A\n|  B' {\n}\n");
		expect(enter('task a "A" {\n  note "one|\n  two"\n}\n')).toBe(
			'task a "A" {\n  note "one\n|\n  two"\n}\n',
		);
		// Unterminated, while typing.
		expect(enter('task a "A" {\n  note "one|  ')).toBe('task a "A" {\n  note "one\n|  ');
	});

	it('indents inside cut-here strings and keeps the previous indentation in comments', () => {
		expect(enter('task a "A" {\n  note -8<-\n    one|\n  ->8-\n}\n')).toBe(
			'task a "A" {\n  note -8<-\n    one\n    |\n  ->8-\n}\n',
		);
		expect(enter('task a "A" {\n    /* one|\n    */\n}\n')).toBe(
			'task a "A" {\n    /* one\n    |\n    */\n}\n',
		);
	});

	it('treats the edges of a string as outside it', () => {
		const doc = 'task a "A" {\n}\n';
		const s = tjpState(doc);
		expect(inQuotedString(s, doc.indexOf('"A"'))).toBe(false);
		expect(inQuotedString(s, doc.indexOf('"A"') + 1)).toBe(true);
		expect(inQuotedString(s, doc.indexOf('"A"') + 3)).toBe(false);
		// A body's `{` on its own line sits at the header's level, as format puts it.
		expect(enter('task a "A"| {\n}\n')).toBe('task a "A"\n|{\n}\n');
	});

	it("uses the file's indent unit", () => {
		expect(enter('task a "A" {\n\ttask b "B" {|\n\t}\n}\n')).toBe(
			'task a "A" {\n\ttask b "B" {\n\t\t|\n\t}\n}\n',
		);
		expect(enter('task a "A" {\n    effort 5d\n}\ntask b "B" {|\n}\n')).toBe(
			'task a "A" {\n    effort 5d\n}\ntask b "B" {\n    |\n}\n',
		);
	});
});

describe('textIndentUnit', () => {
	it('defaults to two spaces and reads tabs and other widths', () => {
		const unit = (doc: string): string => textIndentUnit(textOf(doc));
		expect(unit('task a "A"\n')).toBe('  ');
		expect(unit('task a "A" {\n\teffort 1d\n}\n')).toBe('\t');
		expect(unit('task a "A" {\n   effort 1d\n}\n')).toBe('   ');
		expect(getIndentUnit(tjpState('task a "A" {\n    effort 1d\n}\n'))).toBe(4);
	});

	it('agrees with format.ts detectIndentUnit on the corpora', () => {
		const differ: string[] = [];
		let n = 0;
		for (const corpus of CORPORA) {
			for (const file of corpus.files) {
				const text = readTjp(file);
				const f = createFile(file, text);
				if (detectIndentUnit(f) !== textIndentUnit(f.text)) differ.push(file);
				n++;
			}
		}
		expect(n).toBeGreaterThan(100);
		expect(differ).toEqual([]);
	});
});

describe('agreement with format on demand', () => {
	it('gives every absolute line of a formatted corpus file the indentation format wrote', () => {
		let lines = 0;
		const mismatches: string[] = [];
		for (const corpus of CORPORA.filter((c) => c.name !== 'Syntax/Correct')) {
			for (const file of corpus.files) {
				if (NEGATIVE.has(file)) continue;
				const text = readTjp(file);
				let f = createFile(file, text);
				if (syntaxIssues(f.tree, f.text).length > 0) continue;
				const r = formatFile(f);
				if (r.status !== 'format') continue;
				f = updateFile(f, changeSetOf([...r.changes], f.text.length));
				const state = tjpState(f.text.toString());
				const infos = analyzeLines(f);
				for (let i = 1; i <= state.doc.lines; i++) {
					const info = infos[i - 1];
					if (!info || info.kind !== 'absolute') continue;
					const line = state.doc.line(i);
					const have = countColumn(/^[ \t]*/.exec(line.text)?.[0] ?? '', state.tabSize);
					const want = getIndentation(new IndentContext(state), line.from);
					lines++;
					if (want !== have && mismatches.length < 10)
						mismatches.push(`${file}:${i}: ${want} vs ${have}`);
				}
			}
		}
		expect(lines).toBeGreaterThan(5_000);
		expect(mismatches).toEqual([]);
	});
});
