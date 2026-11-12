// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { movedText } from './task-text';
import { setup, span, stmt } from './testing';

const H = 'project p "P" 2026-01-05 +2m\n';

describe('movedText', () => {
	it('re-indents absolute lines by depth and keeps continuation offsets', () => {
		const s = setup(
			H + 'task a "A" {\n  task b "B" {\n    depends a,\n        a\n    task c "C"\n  }\n}\n',
		);
		const f = s.file();
		const b = stmt(f, 'task b');
		const r = movedText(f, b, b.from, { base: '\t\t', unit: '\t', eol: '\r\n' });
		expect(r.text).toBe(
			'task b "B" {\r\n\t\t\tdepends a,\r\n\t\t\t    a\r\n\t\t\ttask c "C"\r\n\t\t}',
		);
		expect(r.blockAt).toBe(0);
	});

	it('starts at leading comments, reports where the block starts and applies substitutions', () => {
		const s = setup(
			H + 'task a "A" {\n  # c\n  task b "B" {\n    depends !x\n  }\n  task x "X"\n}\n',
		);
		const f = s.file();
		const b = stmt(f, 'task b');
		const from = span(f, '# c').from;
		const ref = span(f, '!x');
		const r = movedText(f, b, from, { base: '', unit: '  ', eol: '\n' }, [
			{ at: ref, insert: 'a.x' },
		]);
		expect(r.text).toBe('# c\ntask b "B" {\n  depends a.x\n}');
		expect(r.text.slice(r.blockAt, r.blockAt + 4)).toBe('task');
	});

	it('moves cut-here strings with their statement, in destination units', () => {
		const text =
			H +
			'task w "W" {\n\ttask k "K" {\n\t\tnote -8<-\n\t\t\tone\n\t\t\t  two\n\n\t\t->8-\n\t}\n}\n';
		const s = setup(text);
		const f = s.file();
		const k = stmt(f, 'task k');
		const r = movedText(f, k, k.from, { base: '  ', unit: '  ', eol: '\n' });
		// The first inner line's indentation is stripped from every line: the value is unchanged.
		expect(r.text).toBe('task k "K" {\n    note -8<-\n      one\n        two\n\n    ->8-\n  }');
	});

	it('leaves macro bodies, quoted strings and block comments as written', () => {
		const text = H + 'task a "A" {\n  task b "B" {\n    note "q\n  r"\n    /* c\n   d */\n  }\n}\n';
		const s = setup(text);
		const f = s.file();
		const b = stmt(f, 'task b');
		const r = movedText(f, b, b.from, { base: '', unit: '  ', eol: '\n' });
		expect(r.text).toBe('task b "B" {\n  note "q\n  r"\n  /* c\n   d */\n}');
	});
});
