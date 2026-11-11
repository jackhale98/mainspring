// SPDX-License-Identifier: GPL-2.0-or-later
// Consistency of the term tables (terms.ts) with the generated parser.
import { describe, expect, it } from 'vitest';
import { keywordById } from '../syntax/keywords';
import { tjpGlobalParser } from './parser';
import { HEAD_KEYWORD_TERMS, STATEMENT_TERMS, TYPED_KEYWORDS } from './terms';

const types = tjpGlobalParser.nodeSet.types;

describe('term tables', () => {
	it('list every statement node', () => {
		const statements = types.filter((t) => t.name.endsWith('Statement')).map((t) => t.id);
		expect(new Set(statements)).toEqual(STATEMENT_TERMS);
	});

	it('use keyword heads named Keyword', () => {
		for (const term of HEAD_KEYWORD_TERMS) expect(types[term]?.name).toBe('Keyword');
	});

	it('map table keywords to statements named after them', () => {
		for (const [id, { statement }] of TYPED_KEYWORDS) {
			const name = keywordById(id)?.name ?? '';
			expect(name, id).not.toBe('');
			expect(types[statement]?.name).toBe(`${name[0]?.toUpperCase()}${name.slice(1)}Statement`);
		}
	});
});
