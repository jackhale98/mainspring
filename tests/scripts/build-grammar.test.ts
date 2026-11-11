// SPDX-License-Identifier: GPL-2.0-or-later
// scripts/build-grammar.mjs: the committed parser matches the grammar, --check compares, and
// generator warnings fail the build.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	compareFile,
	generate,
	GRAMMAR,
	PARSER_OUT,
	TERMS_OUT,
} from '../../scripts/build-grammar.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('build-grammar', () => {
	it('regenerates exactly the committed parser and terms', async () => {
		const fresh = await generate(read(GRAMMAR));
		expect(compareFile(PARSER_OUT, read(PARSER_OUT), fresh.parser)).toBeNull();
		expect(compareFile(TERMS_OUT, read(TERMS_OUT), fresh.terms)).toBeNull();
		expect(fresh.parser.startsWith('// SPDX-License-Identifier: GPL-2.0-only\n')).toBe(true);
	}, 30_000);

	it('reports the first differing line', () => {
		expect(compareFile('f.ts', 'a\nb\nc\n', 'a\nB\nc\n')).toContain('line 2');
		expect(compareFile('f.ts', null, 'x')).toContain('missing');
		expect(compareFile('f.ts', 'x', 'x')).toBeNull();
	});

	it('fails on generator warnings', async () => {
		await expect(generate('@top File { A* }\nA { "a" }\nunused { "b" }')).rejects.toThrow(
			/warnings/,
		);
	});
});
