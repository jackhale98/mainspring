// SPDX-License-Identifier: GPL-2.0-or-later
// checkTokenStream and expectedScannedText on hand-written oracle results. The oracle itself runs
// in the engine; tests/engine/token-oracle-smoke.test.ts runs it on fixtures.
import { describe, expect, it } from 'vitest';
import {
	checkTokenStream,
	expectedScannedText,
	type OracleItem,
	type OracleToken,
	type TokenOracleResult,
} from './token-oracle';

function token(from: number, to: number, text: string, extra: Partial<OracleToken> = {}): OracleToken {
	return { kind: 'token', type: 'ID', from, to, text, value: text, line: 1, macros: [], ...extra };
}

function result(tokens: OracleItem[], scanError: TokenOracleResult['scanError'] = null): TokenOracleResult {
	return { units: 'utf16', tokens, scanError };
}

// '\uFEFF' 't${m}' ' ' '"a\r\nb"' '\r\n'
const TEXT = '\uFEFFt${m} "a\r\nb"\r\n';
const GOOD: OracleItem[] = [
	{ kind: 'bom', from: 0, to: 1, text: '\uFEFF' },
	token(1, 6, 't_', {
		macros: [{ kind: 'macro', from: 2, to: 6, name: 'm', optional: false, args: [] }],
	}),
	{ kind: 'whitespace', from: 6, to: 7, text: ' ' },
	token(7, 13, '"a\nb"', { type: 'STRING', value: 'a\nb' }),
	{ kind: 'whitespace', from: 13, to: 15, text: '\n' },
];

describe('expectedScannedText', () => {
	it('turns CRLF and CR into LF', () => {
		expect(expectedScannedText('a\r\nb\rc', { kind: 'whitespace', from: 0, to: 6, text: '' })).toBe(
			'a\nb\nc',
		);
	});

	it('reads each macro call as one underscore', () => {
		const text = '"${a "x"} and ${b}"';
		const item = token(0, text.length, '', {
			macros: [
				{ kind: 'macro', from: 1, to: 9, name: 'a', optional: false, args: ['x'] },
				{ kind: 'macro', from: 14, to: 18, name: 'b', optional: false, args: [] },
			],
		});
		expect(expectedScannedText(text, item)).toBe('"_ and _"');
	});
});

describe('checkTokenStream', () => {
	it('accepts a consistent stream', () => {
		expect(checkTokenStream(TEXT, result(GOOD))).toEqual([]);
	});

	it('reports gaps, overlaps and a short stream', () => {
		const gap = [...GOOD.slice(0, 2), ...GOOD.slice(3)];
		expect(checkTokenStream(TEXT, result(gap)).join('\n')).toMatch(/starts at 7, expected 6/);
		expect(checkTokenStream(TEXT, result(GOOD.slice(0, 4)))).toEqual([
			'items end at 13, expected 15',
		]);
	});

	it('reports text that does not match the slice', () => {
		const wrong = GOOD.map((i) => (i.kind === 'whitespace' && i.from === 13 ? { ...i, text: '\r\n' } : i));
		expect(checkTokenStream(TEXT, result(wrong))).toEqual([
			'item 4 (whitespace 13-15) text "\\r\\n", slice gives "\\n"',
		]);
	});

	it('reports a macro call outside its token or not on a call', () => {
		const bad = GOOD.map((i) =>
			i.kind === 'token' && i.from === 1
				? { ...i, macros: [{ kind: 'macro' as const, from: 1, to: 6, name: 'm', optional: false, args: [] }] }
				: i,
		);
		expect(checkTokenStream(TEXT, result(bad)).join('\n')).toMatch(/has a macro call at 1-6/);
	});

	it('reports a BOM item that is not the leading U+FEFF', () => {
		const text = 'x';
		expect(checkTokenStream(text, result([{ kind: 'bom', from: 0, to: 1, text: 'x' }]))).toEqual([
			'item 0 (bom 0-1) is not a leading U+FEFF',
		]);
	});

	it('expects the items to stop where a scanner error starts', () => {
		const text = 'a "open';
		const items: OracleItem[] = [token(0, 1, 'a'), { kind: 'whitespace', from: 1, to: 2, text: ' ' }];
		const error = { id: 'runaway_token', message: 'm', line: 1, from: 2, to: 7 };
		expect(checkTokenStream(text, result(items, error))).toEqual([]);
		expect(checkTokenStream(text, result(items, { ...error, to: 9 }))).toEqual([
			'scanError runaway_token has range 2-9',
		]);
		expect(checkTokenStream(text, result(items.slice(0, 1), error))).toEqual([
			'items end at 1, expected 2',
		]);
	});
});
