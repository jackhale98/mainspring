// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { TokenFlag, isTrivia, taskJugglerType, type TjpTokenKind } from './token-kinds';

const ALL: TjpTokenKind[] = [
	'Whitespace',
	'LineComment',
	'BlockComment',
	'Bom',
	'ScenarioPrefix',
	'AbsoluteId',
	'Identifier',
	'Date',
	'Time',
	'Float',
	'Integer',
	'String',
	'MacroBody',
	'MacroCall',
	'MacroWord',
	'EnvRef',
	'Punct',
	'Error',
];

describe('token kinds', () => {
	it('marks exactly whitespace, comments and the BOM as trivia', () => {
		expect(ALL.filter(isTrivia)).toEqual(['Whitespace', 'LineComment', 'BlockComment', 'Bom']);
	});

	it('maps significant kinds to TaskJuggler token types', () => {
		expect(Object.fromEntries(ALL.map((k) => [k, taskJugglerType(k)]))).toEqual({
			Whitespace: null,
			LineComment: null,
			BlockComment: null,
			Bom: null,
			ScenarioPrefix: 'ID_WITH_COLON',
			AbsoluteId: 'ABSOLUTE_ID',
			Identifier: 'ID',
			Date: 'DATE',
			Time: 'TIME',
			Float: 'FLOAT',
			Integer: 'INTEGER',
			String: 'STRING',
			MacroBody: 'MACRO',
			MacroCall: null,
			MacroWord: null,
			EnvRef: null,
			Punct: 'LITERAL',
			Error: null,
		});
	});

	it('uses distinct flag bits', () => {
		const bits = Object.values(TokenFlag);
		expect(bits.reduce((a, b) => a | b, 0)).toBe(bits.reduce((a, b) => a + b, 0));
	});
});
