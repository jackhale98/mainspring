// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { KeywordDoc, SyntaxDocs } from '../../../engine/protocol';
import { engineDocsMatch, keywordDoc } from './docs';
import { KEYWORDS, TJ_VERSION } from './keywords';
import type { KeywordEntry } from './types';

function engineDoc(keyword: string, over: Partial<KeywordDoc> = {}): KeywordDoc {
	return {
		keyword,
		contexts: ['task'],
		syntax: 'from engine',
		summary: 'Engine summary.',
		doc: `Full documentation of ${keyword}.\n\nSecond paragraph.`,
		scenarioSpecific: true,
		seeAlso: ['duration', 'length'],
		...over,
	};
}

const engine: SyntaxDocs = { tjVersion: TJ_VERSION, keywords: [engineDoc('effort')] };

describe('keywordDoc', () => {
	it('gives the table entry alone before the engine has loaded', () => {
		const d = keywordDoc({ table: KEYWORDS, engine: null }, 'booking.task');
		expect(d?.keyword).toBe('booking.task');
		expect(d?.name).toBe('booking');
		expect(d?.summary).toMatch(/booking/i);
		expect(d?.doc).toBeNull();
		expect(d?.seeAlso).toEqual([]);
	});

	it('adds the full doc and see-also once the engine has loaded', () => {
		const d = keywordDoc({ table: KEYWORDS, engine }, 'effort');
		const entry = KEYWORDS.find((k) => k.keyword === 'effort');
		expect(d?.doc).toBe('Full documentation of effort.\n\nSecond paragraph.');
		expect(d?.seeAlso).toEqual(['duration', 'length']);
		// Syntax and summary stay the table's.
		expect(d?.syntax).toBe(entry?.syntax);
		expect(d?.summary).toBe(entry?.summary);
		// The same engine object is indexed once and gives the same answer again.
		expect(keywordDoc({ table: KEYWORDS, engine }, 'effort')).toEqual(d);
	});

	it('falls back to the table for keywords the engine docs lack, or an empty doc', () => {
		expect(keywordDoc({ table: KEYWORDS, engine }, 'length')?.doc).toBeNull();
		const empty: SyntaxDocs = {
			tjVersion: TJ_VERSION,
			keywords: [engineDoc('effort', { doc: '' })],
		};
		expect(keywordDoc({ table: KEYWORDS, engine: empty }, 'effort')?.doc).toBeNull();
	});

	it('ignores engine docs from another TaskJuggler version', () => {
		const other: SyntaxDocs = { tjVersion: '9.9.9', keywords: [engineDoc('effort')] };
		expect(engineDocsMatch(engine)).toBe(true);
		expect(engineDocsMatch(other)).toBe(false);
		const d = keywordDoc({ table: KEYWORDS, engine: other }, 'effort');
		expect(d?.doc).toBeNull();
		expect(d?.seeAlso).toEqual([]);
	});

	it('returns null for ids not in the table, including bare names of scoped keywords', () => {
		expect(keywordDoc({ table: KEYWORDS, engine }, 'nonsense')).toBeNull();
		expect(keywordDoc({ table: KEYWORDS, engine }, 'booking')).toBeNull();
	});

	it('reads any table it is given', () => {
		const entry: KeywordEntry = {
			keyword: 'custom',
			name: 'custom',
			contexts: [''],
			scenarioSpecific: false,
			syntax: 'custom',
			summary: 'A test keyword.',
		};
		expect(keywordDoc({ table: [entry], engine: null }, 'custom')).toEqual({
			...entry,
			doc: null,
			seeAlso: [],
		});
		expect(keywordDoc({ table: [entry], engine: null }, 'effort')).toBeNull();
	});
});
