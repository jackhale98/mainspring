// SPDX-License-Identifier: GPL-2.0-or-later
// fast-check properties: on any input the tokens cover the text exactly, the tokenizer never
// throws, errors behave like TaskJuggler's runaway tokens, and scanning restarts cleanly at
// every token boundary (what Lezer's incremental parser relies on).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { scanTokenAt, tokenizeTjp } from './tokens';

/** Pieces of the TJP alphabet, weighted towards the characters that switch scanner modes. */
const PIECES = [
	'"',
	"'",
	'\\',
	'\n',
	'\r\n',
	'\r',
	' ',
	'\t',
	'\v',
	'\f',
	'#',
	'//',
	'/*',
	'*/',
	'/',
	'*',
	'[',
	']',
	']\n',
	'{',
	'}',
	'-8<-',
	'-8<-\n',
	'->8-',
	'  ->8-',
	'-',
	'<',
	'>',
	'=',
	'!',
	'.',
	':',
	',',
	'+',
	'%',
	'(',
	')',
	'$',
	'${',
	'${x}',
	'${ ?y "a" }',
	'$(HOME)',
	'$(',
	'a',
	'b_1',
	'task',
	'x.y',
	'x:',
	'2024-01-02',
	'2024-1-2-10:30',
	'10:30',
	'1',
	'12',
	'.5',
	'5d',
	'\\"',
	"\\'",
	'é',
	'😀',
	'\ud800',
	'\u00a0',
	'\ufeff',
];
const CHARS = [
	'a',
	'1',
	':',
	'.',
	'-',
	'8',
	'<',
	'>',
	'"',
	"'",
	'\\',
	'\n',
	' ',
	'/',
	'*',
	'#',
	'[',
	']',
	'$',
	'{',
	'}',
	'(',
	')',
	'?',
];

const soup = fc.oneof(
	fc.array(fc.constantFrom(...PIECES), { maxLength: 60 }).map((a) => a.join('')),
	fc.array(fc.constantFrom(...CHARS), { maxLength: 120 }).map((a) => a.join('')),
	fc.string({ unit: 'binary', maxLength: 80 }),
);

const RUNS = 500;

describe('tokenizer properties', () => {
	it('covers the input with no gaps or overlaps, and never throws', () => {
		fc.assert(
			fc.property(soup, (text) => {
				const tokens = tokenizeTjp(text);
				let pos = 0;
				for (const t of tokens) {
					if (t.from !== pos || t.to <= t.from) return false;
					pos = t.to;
				}
				return pos === text.length && tokens.map((t) => text.slice(t.from, t.to)).join('') === text;
			}),
			{ numRuns: RUNS },
		);
	});

	it('runs every error but junk-after-cut to the end, and sets error only on errors', () => {
		fc.assert(
			fc.property(soup, (text) => {
				const tokens = tokenizeTjp(text);
				return tokens.every((t, i) => {
					if (t.kind !== 'Error') return t.error === null;
					return t.error !== null && (t.error === 'junk-after-cut' || i === tokens.length - 1);
				});
			}),
			{ numRuns: RUNS },
		);
	});

	it('emits a BOM only at offset 0 and keeps trivia apart from significant tokens', () => {
		fc.assert(
			fc.property(soup, (text) => {
				const tokens = tokenizeTjp(text);
				return (
					tokens.every((t) => (t.kind === 'Bom' ? t.from === 0 : true)) &&
					tokens.every((t, i) => !(t.kind === 'Whitespace' && tokens[i + 1]?.kind === 'Whitespace'))
				);
			}),
			{ numRuns: RUNS },
		);
	});

	it('scans the same token when restarted at any token boundary', () => {
		fc.assert(
			fc.property(soup, (text) =>
				tokenizeTjp(text).every(
					(t) => JSON.stringify(scanTokenAt(text, t.from)) === JSON.stringify(t),
				),
			),
			{ numRuns: RUNS },
		);
	});

	it('tokenizes a suffix that starts at a boundary the same way', () => {
		fc.assert(
			fc.property(soup, fc.nat(), (text, pick) => {
				const tokens = tokenizeTjp(text);
				const at =
					tokens.length === 0 ? 0 : (tokens[pick % tokens.length] as { from: number }).from;
				// A BOM is only special at offset 0, so skip suffixes that would start with one.
				if (at === 0 || text.charCodeAt(at) === 0xfeff) return true;
				const tail = tokenizeTjp(text.slice(at)).map((t) => [
					t.kind,
					t.from + at,
					t.to + at,
					t.error,
				]);
				const rest = tokenizeTjp(text)
					.filter((t) => t.from >= at)
					.map((t) => [t.kind, t.from, t.to, t.error]);
				expect(tail).toEqual(rest);
				return true;
			}),
			{ numRuns: RUNS },
		);
	});
});
