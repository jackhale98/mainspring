// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { before, checkMovedText, parseOrder } from './task-order';
import { setup, stmt } from './testing';

const H = 'project p "P" 2026-01-05 +2m\n';

describe('parseOrder', () => {
	it('orders positions along the include chain', () => {
		const s = setup({
			'plan.tjp': H + 'task a "A"\ninclude "b.tji"\ntask c "C"\n',
			'b.tji': 'task b "B"\n',
		});
		const inc = s.file().text.toString().indexOf('include');
		const main = (pos: number): number[] => parseOrder(s.index, 'plan.tjp', pos) ?? [];
		const child = parseOrder(s.index, 'b.tji', 0) ?? [];
		expect(before(main(inc - 1), child)).toBe(true);
		expect(before(child, main(inc + 20))).toBe(true);
		expect(parseOrder(s.index, 'nowhere.tji', 0)).toBeNull();
	});
});

describe('checkMovedText', () => {
	const text =
		H +
		'task a "A"\nmacro m [ effort 1d ]\nmacro r [ depends !a ]\ntask b "B" {\n  ${m}\n}\ntask c "C" {\n  ${r}\n}\n';

	it('needs a definition of each called macro before the destination', () => {
		const s = setup(text);
		const f = s.file();
		const b = stmt(f, 'task b');
		const end = f.text.length;
		expect(
			checkMovedText(s.index, f, b.from, b.to, { file: 'plan.tjp', pos: 0 }, false),
		).toMatchObject({
			reason: 'text-only',
		});
		expect(
			checkMovedText(s.index, f, b.from, b.to, { file: 'plan.tjp', pos: end }, false),
		).toBeNull();
	});

	it('refuses macros with relative text when the ids change', () => {
		const s = setup(text);
		const f = s.file();
		const c = stmt(f, 'task c');
		const end = f.text.length;
		expect(
			checkMovedText(s.index, f, c.from, c.to, { file: 'plan.tjp', pos: end }, false),
		).toBeNull();
		expect(
			checkMovedText(s.index, f, c.from, c.to, { file: 'plan.tjp', pos: end }, true),
		).toMatchObject({
			reason: 'unfixable-reference',
		});
	});
});
