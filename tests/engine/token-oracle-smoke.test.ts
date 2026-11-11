// SPDX-License-Identifier: GPL-2.0-or-later
// Smoke test of the token oracle (phase-1 T19) in the built engine, run in Node through
// bootNodeEngine: TaskJuggler's own scanner over a few fixtures, with offsets that slice back to
// each item's text (checkTokenStream). It needs `npm run build:engine` and is skipped when
// public/engine is missing. Native against wasm is engine/golden/check-tokens.mjs (developer-only).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { bootNodeEngine } from '../../engine/golden/run-wasm.mjs';
import type { NodeEngine } from '../../src/engine/runtime';
import {
	checkTokenStream,
	type OracleToken,
	type TokenOracleResult,
} from '../../src/engine/token-oracle';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILT = fs.existsSync(path.join(REPO, 'public', 'engine', 'manifest.json'));

function fixture(name: string): string {
	const bytes = fs.readFileSync(path.join(REPO, 'tests', 'fixtures', 'tjp', name, 'plan.tjp'));
	return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
}

const tokensOf = (r: TokenOracleResult): OracleToken[] =>
	r.tokens.filter((i): i is OracleToken => i.kind === 'token');

describe.skipIf(!BUILT)('token oracle in the built engine', () => {
	let engine: NodeEngine;

	beforeAll(async () => {
		engine = await bootNodeEngine({ log: () => {} });
	}, 120_000);

	function scan(text: string): TokenOracleResult {
		const r = engine.tokens(text);
		expect(checkTokenStream(text, r)).toEqual([]);
		return r;
	}

	/** The token whose slice of `text` is exactly `slice`. */
	function find(text: string, r: TokenOracleResult, slice: string): OracleToken {
		const t = tokensOf(r).find((i) => text.slice(i.from, i.to) === slice);
		if (!t) throw new Error(`no token ${JSON.stringify(slice)}`);
		return t;
	}

	it.each([
		'comments',
		'comments-in-strings',
		'cut-here-strings',
		'crlf-plan',
		'crlf-strings',
		'bom-utf8',
		'macro-args-nested',
		'macro-ids',
		'numbers-dates',
		'one-line-blocks',
		'scenario-prefix',
		'tabs',
	])('tiles %s with offsets that slice back to the scanned text', (name) => {
		const text = fixture(name);
		const r = scan(text);
		expect(r.units).toBe('utf16');
		expect(r.scanError).toBeNull();
		expect(r.tokens.at(-1)?.to).toBe(text.length);
	});

	it('keeps 5d as INTEGER then ID, and reads dates and floats', () => {
		const text = fixture('numbers-dates');
		const r = scan(text);
		const five = find(text, r, '5');
		const next = tokensOf(r).find((t) => t.from === five.to);
		expect([five.type, five.value, next?.type, next?.text]).toEqual(['INTEGER', 5, 'ID', 'd']);
		expect(find(text, r, '.5')).toMatchObject({ type: 'FLOAT', value: 0.5 });
		expect(find(text, r, '2026-01-12')).toMatchObject({
			type: 'DATE',
			value: Date.UTC(2026, 0, 12) / 1000,
		});
		expect(find(text, r, '2026-01-05-09:00-+0000')).toMatchObject({ type: 'DATE', line: 3 });
	});

	it('reads each macro call as one word inside the token around it', () => {
		const text = fixture('macro-args-nested');
		const r = scan(text);
		const glued = find(text, r, 't${major}');
		expect([glued.type, glued.text, glued.macros.map((m) => m.name)]).toEqual([
			'ID',
			't_',
			['major'],
		]);
		const note = find(text, r, '"${content}${major}"');
		expect([note.type, note.value, note.macros.length]).toEqual(['STRING', '__', 2]);
		const call = find(text, r, '"${title "Plain" "name"}"').macros[0];
		expect([call?.name, call?.args, call?.optional]).toEqual(['title', ['Plain', 'name'], false]);
		const optional = find(text, r, '${?undefined}1d');
		expect([optional.text, optional.macros[0]?.optional]).toEqual(['_1d', true]);
	});

	it('reads CRLF as LF and keeps offsets in the original text', () => {
		const text = fixture('crlf-strings');
		const r = scan(text);
		expect(find(text, r, '"line one\r\nline two"')).toMatchObject({
			type: 'STRING',
			value: 'line one\nline two',
			text: '"line one\nline two"',
		});
		const cut = tokensOf(r).find((t) => t.text.startsWith('-8<-'));
		expect(cut).toMatchObject({ type: 'STRING', value: 'cut line\n' });
	});

	it('reports a leading BOM as trivia and counts offsets in UTF-16 units', () => {
		const text = fixture('bom-utf8');
		expect(scan(text).tokens[0]).toEqual({ kind: 'bom', from: 0, to: 1, text: '\uFEFF' });
		const astral = '"\u{1F600}" x\n';
		const r = scan(astral);
		expect(tokensOf(r).map((t) => [t.type, t.from, t.to])).toEqual([
			['STRING', 0, 4],
			['ID', 5, 6],
		]);
	});

	it('keeps the comment and cut-here quirks of the native scanner', () => {
		const text = fixture('comments');
		const r = scan(text);
		const greedy = r.tokens.find((i) => i.kind === 'comment' && i.text.startsWith('/* greedy'));
		expect(greedy?.text).toBe('/* greedy: first */ task b "B" { effort 1d allocate ana } /* last */');
		const cut = fixture('cut-here-strings');
		const strings = tokensOf(scan(cut)).filter((t) => t.text.startsWith('-8<-'));
		expect(strings.map((t) => t.line)).toEqual([11, 19]);
		expect(strings[1]?.value).toBe('indented ->8- inline is literal\n');
	});

	it.each([
		['neg-unterminated-string', 'runaway_token', 5],
		['neg-junk-after-cut', 'junk_after_cut', 7],
	])('reports the scanner error of %s', (name, id, line) => {
		const text = fixture(name);
		const r = scan(text);
		expect(r.scanError).toMatchObject({ id, line });
		if (id === 'runaway_token') expect(r.scanError?.to).toBe(text.length);
	});
});
