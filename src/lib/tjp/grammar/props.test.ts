// SPDX-License-Identifier: GPL-2.0-or-later
// The stringTemplate prop on TemplateString nodes (props.ts).
import { describe, expect, it } from 'vitest';
import { tjpGlobalParser } from './parser';
import { stringTemplate } from './props';

function templates(text: string): (string | null)[] {
	const out: (string | null)[] = [];
	tjpGlobalParser.parse(text).iterate({
		enter(n) {
			if (n.name === 'String') out.push(null);
			if (n.name !== 'TemplateString') return;
			const p = n.type.prop(stringTemplate);
			out.push(
				p ? `${p.macro ? 'macro' : ''}${p.macro && p.env ? '+' : ''}${p.env ? 'env' : ''}` : '?',
			);
		},
	});
	return out;
}

describe('stringTemplate', () => {
	it('says what a templated string expands', () => {
		expect(
			templates('task t "plain" { note "${a}" note "$(HOME)" note "${a} $(HOME)" note \'${b}\' }'),
		).toEqual([null, 'macro', 'env', 'macro+env', 'macro']);
	});

	it('is absent on plain strings', () => {
		let props = 0;
		tjpGlobalParser.parse('task t "x" { note "y" }').iterate({
			enter(n) {
				if (n.type.prop(stringTemplate)) props++;
			},
		});
		expect(props).toBe(0);
	});
});
