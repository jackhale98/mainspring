// SPDX-License-Identifier: GPL-2.0-or-later
// Tokenizer API, corpora (fixtures, goldens, upstream examples and syntax tests) and timing.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanTokenAt, tokenizeTjp, type TjpToken } from './tokens';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function tjpFiles(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir).sort()) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) out.push(...tjpFiles(path));
		else if (/\.tj[pi]$/.test(name)) out.push(path);
	}
	return out;
}

/** Decode as the app does (phase-1.md 9.1): keep a BOM, replace invalid bytes. */
function read(path: string): string {
	return new TextDecoder('utf-8', { ignoreBOM: true }).decode(readFileSync(path));
}

/** Tokens are contiguous from 0 to the end, and their texts concatenate to the input. */
function expectLossless(text: string, tokens: readonly TjpToken[]): void {
	let pos = 0;
	let joined = '';
	for (const t of tokens) {
		expect(t.from).toBe(pos);
		expect(t.to).toBeGreaterThan(t.from);
		joined += text.slice(t.from, t.to);
		pos = t.to;
	}
	expect(pos).toBe(text.length);
	expect(joined).toBe(text);
}

describe('tokenizeTjp', () => {
	it('returns no tokens for empty input', () => {
		expect(tokenizeTjp('')).toEqual([]);
	});
	it('gives offsets, flags and errors for every token', () => {
		expect(tokenizeTjp('task a "A" {}')).toEqual([
			{ kind: 'Identifier', from: 0, to: 4, flags: 0, error: null },
			{ kind: 'Whitespace', from: 4, to: 5, flags: 0, error: null },
			{ kind: 'Identifier', from: 5, to: 6, flags: 0, error: null },
			{ kind: 'Whitespace', from: 6, to: 7, flags: 0, error: null },
			{ kind: 'String', from: 7, to: 10, flags: 0, error: null },
			{ kind: 'Whitespace', from: 10, to: 11, flags: 0, error: null },
			{ kind: 'Punct', from: 11, to: 12, flags: 0, error: null },
			{ kind: 'Punct', from: 12, to: 13, flags: 0, error: null },
		]);
	});
	it('is lossless on CRLF, tabs and mixed content', () => {
		const text = '\ufeffproject p "P" 2024-01-01 +1m {\r\n\ttimezone "UTC"\r\n}\r\n# end\r\n';
		expectLossless(text, tokenizeTjp(text));
	});
});

describe('scanTokenAt', () => {
	it('scans the token at any token boundary, as an incremental parser restarts', () => {
		const text = 'macro m [\n  x\n]\ntask t "${m}" { note -8<-\n  a\n  ->8- }\n';
		for (const t of tokenizeTjp(text)) expect(scanTokenAt(text, t.from)).toEqual(t);
		expect(scanTokenAt(text, text.length)).toBeNull();
	});
});

const DIRS = ['tests/fixtures/tjp', 'engine/golden/plans', 'engine/tj/examples'];
/** Deliberately invalid fixtures, with the error each must produce (relative path, reason). */
const NEGATIVE: Record<string, string> = {
	'tests/fixtures/tjp/neg-junk-after-cut/plan.tjp': 'junk-after-cut',
	'tests/fixtures/tjp/neg-unterminated-string/plan.tjp': 'unterminated-string',
};

describe('corpus', () => {
	const files = DIRS.flatMap((d) => tjpFiles(join(ROOT, d)));

	it('finds the fixture, golden and example files', () => {
		const rel = files.map((f) => relative(ROOT, f));
		expect(rel.filter((f) => f.startsWith('engine/golden/plans/')).length).toBeGreaterThanOrEqual(
			35,
		);
		expect(rel.filter((f) => f.startsWith('engine/tj/examples/'))).toHaveLength(6);
		expect(rel).toContain('engine/golden/plans/bridge/bom-invalid-utf8/plan.tjp');
		expect(rel).toEqual(expect.arrayContaining(Object.keys(NEGATIVE)));
	});

	it.each(files.map((f) => [relative(ROOT, f), f]))('%s', (rel, path) => {
		const text = read(path);
		const tokens = tokenizeTjp(text);
		expectLossless(text, tokens);
		const errors = tokens.filter((t) => t.kind === 'Error').map((t) => t.error);
		const expected = NEGATIVE[rel];
		expect(errors).toEqual(expected ? [expected] : []);
	});

	it('keeps the BOM of the BOM fixtures as trivia', () => {
		for (const rel of [
			'tests/fixtures/tjp/bom-utf8/plan.tjp',
			'engine/golden/plans/bridge/bom-invalid-utf8/plan.tjp',
		]) {
			expect(tokenizeTjp(read(join(ROOT, rel)))[0]).toMatchObject({ kind: 'Bom', from: 0, to: 1 });
		}
	});

	it('reads the macro fixtures as macro tokens and templated strings', () => {
		const text = read(join(ROOT, 'tests/fixtures/tjp/macro-ids/plan.tjp'));
		const macro = tokenizeTjp(text)
			.filter(
				(t) => t.kind === 'MacroCall' || t.kind === 'MacroWord' || (t.kind === 'String' && t.flags),
			)
			.map((t) => `${t.kind}:${text.slice(t.from, t.to)}`);
		expect(macro).toEqual([
			'MacroWord:${who}2',
			'MacroCall:${tid}',
			'String:"${nm} phase"',
			'MacroWord:${tid}_sub',
			'String:"${nm} sub ${who}"',
			'MacroCall:${who}',
			'String:"Literal ${nm}"',
			'MacroCall:${tid}',
		]);
	});

	it('has no error tokens in TaskJuggler’s Syntax/Correct suite', () => {
		const suite = tjpFiles(join(ROOT, 'engine/tj/test/TestSuite/Syntax/Correct'));
		expect(suite.length).toBeGreaterThanOrEqual(79);
		for (const path of suite) {
			const text = read(path);
			const tokens = tokenizeTjp(text);
			expectLossless(text, tokens);
			expect(
				tokens.filter((t) => t.kind === 'Error'),
				relative(ROOT, path),
			).toEqual([]);
		}
	});
});

describe('performance', () => {
	it('tokenizes the 1,000-task synthetic plan well under budget', () => {
		const text = read(join(ROOT, 'engine/golden/plans/synthetic/20-scale-1000/plan.tjp'));
		tokenizeTjp(text); // warm up
		const runs: number[] = [];
		for (let i = 0; i < 5; i++) {
			const t0 = performance.now();
			tokenizeTjp(text);
			runs.push(performance.now() - t0);
		}
		const best = Math.min(...runs);
		console.info(
			`tokenizeTjp 20-scale-1000 (${text.split('\n').length} lines): best ${best.toFixed(1)} ms`,
		);
		// Target is under 50 ms; asserted loosely so slow CI machines do not flake.
		expect(best).toBeLessThan(200);
	});
});
