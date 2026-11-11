// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The value lexer (lex.ts) and the file tokenizer (grammar/tokens.ts, T4) are two ports of
 * TaskJuggler's ProjectFileScanner. They must agree on every significant token, kind and range,
 * up to the first token the value lexer does not handle (macro bodies and calls, env references,
 * templated strings, error tokens). Checked on every corpus file and on seeded fuzz input.
 */
import fc from 'fast-check';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TokenFlag, isTrivia, tokenizeTjp, type TjpTokenKind } from '../grammar/tokens';
import { ValueLexer, type TokenKind } from './lex';
import { ValueParseError } from './result';

const KIND: Readonly<Record<TokenKind, TjpTokenKind>> = {
	date: 'Date',
	time: 'Time',
	float: 'Float',
	integer: 'Integer',
	id: 'Identifier',
	absId: 'AbsoluteId',
	idColon: 'ScenarioPrefix',
	string: 'String',
	literal: 'Punct',
};
const STOP: ReadonlySet<TjpTokenKind> = new Set([
	'MacroBody',
	'MacroCall',
	'MacroWord',
	'EnvRef',
	'Error',
]);

/** The first disagreement, or null. */
function disagreement(text: string): string | null {
	const lx = new ValueLexer(text);
	const next = () => {
		try {
			return lx.next();
		} catch (e) {
			if (e instanceof ValueParseError) return e.error;
			throw e;
		}
	};
	for (const a of tokenizeTjp(text)) {
		if (isTrivia(a.kind)) continue;
		if (STOP.has(a.kind) || (a.kind === 'String' && a.flags & (TokenFlag.Macro | TokenFlag.Env)))
			return null;
		const b = next();
		const want = `${a.kind} ${a.from}-${a.to}`;
		if (b === null) return `value lexer ended; tokenizer has ${want}`;
		if (!('kind' in b)) return `value lexer failed (${b.code} at ${b.from}); tokenizer has ${want}`;
		const got = `${KIND[b.kind]} ${b.from}-${b.to}`;
		if (got !== want) return `tokenizer ${want}, value lexer ${got}`;
	}
	const b = next();
	return b === null ? null : `value lexer has more: ${JSON.stringify(b)}`;
}

const ROOT = new URL('../../../../', import.meta.url).pathname;
function walk(dir: string): string[] {
	return readdirSync(join(ROOT, dir)).flatMap((name) => {
		const rel = `${dir}/${name}`;
		if (statSync(join(ROOT, rel)).isDirectory()) return walk(rel);
		return /\.tj[pi]$/.test(name) ? [rel] : [];
	});
}
const FILES = [
	'engine/golden/plans',
	'tests/fixtures/tjp',
	'engine/tj/examples',
	'engine/tj/test/TestSuite/Syntax/Correct',
].flatMap(walk);

describe('value lexer and file tokenizer agree', () => {
	it('on every corpus file', () => {
		const bad: string[] = [];
		for (const file of FILES) {
			const text = readFileSync(join(ROOT, file), 'utf8');
			// A leading BOM is trivia to the tokenizer (the bridge strips it, ADR-0002 #13) but a
			// literal to TaskJuggler and to the value lexer, which never sees a whole file.
			if (text.startsWith('﻿')) continue;
			const d = disagreement(text);
			if (d) bad.push(`${file}: ${d}`);
		}
		expect(FILES.length).toBeGreaterThan(150);
		expect(bad).toEqual([]);
	});

	it('on fuzz input over the TJP alphabet', () => {
		const piece = fc.constantFrom(
			...['5', 'd', ' ', '\n', '\r', '\t', '-', '+', ',', '"', "'", '\\', '%', '{', '}', '!', '='],
			...['.', ':', '#', '/', '*', '<', '>', '2026-01-05', '-09:00', '--0100', '9:00', 'mon'],
			...['a.b', 'x:', '-8<-', '->8-', 'é', '😀', '${x}', '$(HOME)', '[', ']'],
		);
		fc.assert(
			fc.property(fc.array(piece, { maxLength: 16 }), (pieces) => {
				expect(disagreement(pieces.join(''))).toBeNull();
			}),
			{ numRuns: 200, seed: 20261111 },
		);
	});
});
