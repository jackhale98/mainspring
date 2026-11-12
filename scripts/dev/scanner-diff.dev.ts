// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Dev-only differential check of the tokenizer port (src/lib/tjp/grammar) against TaskJuggler's
 * own scanner, run natively through scripts/dev/tj-tokens.rb. Not part of CI or of any npm
 * script: CI never runs a native TaskJuggler interpreter (T19 runs the wasm oracle there).
 *
 *   npx vitest run --config scripts/dev/vitest.config.ts
 *   RUNS=20000 SEED=7 LEN=200 npx vitest run --config scripts/dev/vitest.config.ts
 *
 * Compares, for every buffer without macro calls or env references: the type, start and end
 * of each significant token, and the value of identifiers, punctuation, quoted strings and
 * macro bodies; and that the port produces an `Error` token where TaskJuggler's scanner stops
 * with a scanner error. Buffers are the corpora (fixtures, goldens, upstream examples and
 * tests) and seeded random soup from the TJP alphabet, with CRLF and lone CR breaks.
 *
 * TaskJuggler reads files through `forceUTF8Encoding`, which turns `\r\n` and `\r` into `\n`;
 * the oracle does the same, and its offsets are mapped back to the original text here.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { isTrivia, taskJugglerType, tokenizeTjp } from '../../src/lib/tjp/grammar/tokens';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const RUNS = Number(process.env['RUNS'] ?? 5000);
const LEN = Number(process.env['LEN'] ?? 120);
let seed = Number(process.env['SEED'] ?? 1) >>> 0;

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
	'a',
	'b_1',
	'task',
	'x.y',
	'x:',
	'2024-01-02',
	'2024-1-2-10:30',
	'2026-01-05-09:00:30-+0100',
	'10:30',
	'1',
	'12',
	'.5',
	'5d',
	'\\"',
	"\\'",
	']\r\n',
	']\r',
	'-8<-\r\n',
	'-8<-\r',
	'/*\r',
	'#\r',
	'\r\r\n',
	'é',
	'😀',
	'\u00a0',
	'\ufeff',
];
const CHARS = [
	'a',
	'1',
	'2',
	'0',
	'4',
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
	'\r',
	' ',
	'/',
	'*',
	'#',
	'[',
	']',
	'!',
	'=',
	'_',
	'+',
	'é',
];

function rnd(n: number): number {
	seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
	return (seed >>> 8) % n;
}

function soup(i: number): string {
	const alphabet = i % 2 ? PIECES : CHARS;
	let s = '';
	for (let n = rnd(LEN), j = 0; j < n; j++) s += alphabet[rnd(alphabet.length)];
	return s;
}

function tjpFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return tjpFiles(path);
		return /\.tj[pi]$/.test(name) ? [path] : [];
	});
}

interface OracleResult {
	tokens: [string, number, number, string][];
	error: { id: string; at: number } | null;
}

function oracle(texts: string[]): OracleResult[] {
	const out = execFileSync(
		'ruby',
		['-I', join(ROOT, 'engine/tj/lib'), join(ROOT, 'scripts/dev/tj-tokens.rb')],
		{
			input: JSON.stringify(texts),
			env: { ...process.env, TZ: 'UTC' },
			maxBuffer: 1 << 30,
		},
	);
	return JSON.parse(out.toString()) as OracleResult[];
}

/** Maps UTF-8 byte offsets of `text` to UTF-16 offsets. */
function byteOffsets(text: string): (byte: number) => number {
	const map = new Map<number, number>();
	let b = 0;
	for (let i = 0; i < text.length;) {
		map.set(b, i);
		const cp = text.codePointAt(i) ?? 0;
		b += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
		i += cp > 0xffff ? 2 : 1;
	}
	map.set(b, text.length);
	return (byte) => {
		const at = map.get(byte);
		if (at === undefined) throw new Error(`byte offset ${byte} is inside a character`);
		return at;
	};
}

/** The text TaskJuggler scans, and the original offset of each of its offsets. */
function normalise(text: string): { norm: string; orig: number[] } {
	let norm = '';
	const orig: number[] = [];
	for (let i = 0; i < text.length;) {
		const c = text[i] as string;
		orig.push(i);
		if (c === '\r') {
			norm += '\n';
			i += text[i + 1] === '\n' ? 2 : 1;
		} else {
			norm += c;
			i++;
		}
	}
	orig.push(text.length);
	return { norm, orig };
}

/** The value TaskJuggler gives a token, where it can be compared as text; null otherwise. */
function portValue(kind: string, raw: string, flags: number): string | null {
	const s = raw.replace(/\r\n?/g, '\n');
	if (kind === 'Identifier' || kind === 'AbsoluteId' || kind === 'Punct') return s;
	if (kind === 'ScenarioPrefix') return s.slice(0, -1);
	if (kind === 'MacroBody') return s.slice(1, -1);
	if (kind === 'String' && !(flags & 8)) return s.slice(1, -1).split(`\\${s[0]}`).join(s[0]);
	return null;
}

const SCANNER_ERRORS = ['runaway_token', 'no_token_match', 'junk_after_cut'];

/** A mismatch description, or null when the port agrees with TaskJuggler. */
function compare(text: string, res: OracleResult): string | null {
	const { norm, orig } = normalise(text);
	const toUtf16 = byteOffsets(norm);
	const at = (byte: number): number => orig[toUtf16(byte)] as number;
	let theirs = res.tokens.map(([type, a, b, v]) => ({ type, from: at(a), to: at(b), v }));
	// The port keeps a leading BOM as trivia; TaskJuggler returns it as a LITERAL.
	if (text.startsWith('\ufeff') && theirs[0]?.from === 0) theirs = theirs.slice(1);
	const ours = tokenizeTjp(text).filter((t) => !isTrivia(t.kind));
	for (const [i, t] of theirs.entries()) {
		const o = ours[i];
		if (!o) return `#${i}: TaskJuggler ${t.type} ${t.from}-${t.to}, port none`;
		// TaskJuggler's MACRO also consumes the line break after `]` (`\r\n` is one).
		const brk = text[o.to] === '\r' && text[o.to + 1] === '\n' ? 2 : 1;
		const end = o.kind === 'MacroBody' ? o.to + brk : o.to;
		const v = portValue(o.kind, text.slice(o.from, o.to), o.flags);
		if (
			taskJugglerType(o.kind) !== t.type ||
			o.from !== t.from ||
			end !== t.to ||
			(v !== null && v !== t.v)
		) {
			return `#${i}: TaskJuggler ${t.type} ${t.from}-${t.to} ${JSON.stringify(t.v)}, port ${o.kind} ${o.from}-${o.to} ${JSON.stringify(v)}`;
		}
	}
	const next = ours[theirs.length];
	if (!res.error) return next ? `extra port token ${next.kind} at ${next.from}` : null;
	const where = at(res.error.at);
	if (SCANNER_ERRORS.includes(res.error.id)) {
		return next?.kind === 'Error' && next.from === where
			? null
			: `TaskJuggler ${res.error.id} at ${where}, port ${next?.kind ?? 'none'}`;
	}
	// Value errors (bad dates or times) stop TaskJuggler after a valid token boundary.
	return next?.kind === 'Error' ? `TaskJuggler value error ${res.error.id}, port Error` : null;
}

it('agrees with TaskJuggler’s scanner on the corpora and on random soup', () => {
	const inputs: { name: string; text: string }[] = [];
	for (const dir of [
		'tests/fixtures/tjp',
		'engine/golden/plans',
		'engine/tj/examples',
		'engine/tj/test',
	]) {
		for (const path of tjpFiles(join(ROOT, dir))) {
			const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(readFileSync(path));
			inputs.push({ name: relative(ROOT, path), text });
		}
	}
	for (let i = 0; i < RUNS; i++) inputs.push({ name: `soup #${i}`, text: soup(i) });
	const checked = inputs.filter((x) => !/\$\{|\$\(|\ufffd/.test(x.text));
	const failures: string[] = [];
	for (let k = 0; k < checked.length; k += 2000) {
		const batch = checked.slice(k, k + 2000);
		oracle(batch.map((x) => x.text)).forEach((res, i) => {
			const input = batch[i] as { name: string; text: string };
			const why = compare(input.text, res);
			if (why)
				failures.push(
					`${input.name}: ${why}\n    ${JSON.stringify(input.text.slice(0, Number(process.env['SHOW'] ?? 200)))}`,
				);
		});
	}
	console.info(
		`compared ${checked.length} buffers (${inputs.length - checked.length} with macros skipped), ${failures.length} mismatches`,
	);
	expect(failures.slice(0, 20)).toEqual([]);
});
