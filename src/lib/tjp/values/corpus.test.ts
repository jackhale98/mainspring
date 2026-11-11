// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Real-world inputs: every one-line MVP statement in the golden plans, the T16 fixtures and
 * TaskJuggler's own `Syntax/Correct` suite parses to a typed value, and its canonical print means
 * the same. Then the golden results pin the date semantics: each plan's project interval and
 * `now` must resolve to the instants native TaskJuggler reported (time zones included).
 *
 * Statements are found line by line; a small state machine skips lines that start inside a
 * string, comment or macro body. Lines with macro calls, braces or a trailing comma are skipped
 * (they are text-only, block statements or lists that continue).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTimeZoneHost } from '../../../engine/runtime';
import {
	KEYWORD_VALUE_KIND,
	parseDate,
	parseInterval,
	parseValue,
	printValue,
	projectContext,
	resolveDate,
	resolveInterval,
	sameValue,
	utcSeconds,
} from './index';

const ROOT = new URL('../../../../', import.meta.url).pathname;
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

interface Golden {
	id: string;
	root: string;
	entry: string;
}
const goldens = JSON.parse(read('engine/golden/manifest.json')) as Golden[];
const expected = (id: string) =>
	JSON.parse(read(`engine/golden/expected/${id}.json`)) as {
		files: string[];
		options: { now: string | null } | null;
		result: { project: { start: string; end: string; now: string } | null };
	};

function walk(dir: string): string[] {
	return readdirSync(join(ROOT, dir)).flatMap((name) => {
		const rel = `${dir}/${name}`;
		if (statSync(join(ROOT, rel)).isDirectory()) return walk(rel);
		return /\.tj[pi]$/.test(name) ? [rel] : [];
	});
}

const FILES = [
	...goldens.flatMap((g) => expected(g.id).files.map((f) => `${g.root}/${f}`)),
	...walk('tests/fixtures/tjp'),
	...walk('engine/tj/test/TestSuite/Syntax/Correct'),
];

/** Lines (1-based numbers) that start outside strings, comments and macro bodies. */
function codeLines(text: string): Array<[number, string]> {
	const out: Array<[number, string]> = [];
	let mode: 'code' | 'dq' | 'sq' | 'cut' | 'comment' | 'macro' = 'code';
	text.split('\n').forEach((line, n) => {
		if (mode === 'code') out.push([n + 1, line]);
		let i = 0;
		if (mode === 'cut') {
			if (/^\s*->8-/.test(line)) mode = 'code';
			return;
		}
		if (mode === 'macro') {
			if (line.endsWith(']')) mode = 'code';
			return;
		}
		while (i < line.length) {
			const c = line[i];
			if (mode === 'comment') {
				const close = line.lastIndexOf('*/');
				if (close < i) return;
				mode = 'code';
				i = close + 2;
			} else if (mode === 'dq' || mode === 'sq') {
				const q = mode === 'dq' ? '"' : "'";
				if (c === '\\' && line[i + 1] === q) i += 2;
				else if (c === q) ((mode = 'code'), i++);
				else i++;
			} else if (c === '#' || line.startsWith('//', i)) return;
			else if (line.startsWith('/*', i)) ((mode = 'comment'), (i += 2));
			else if (c === '"') ((mode = 'dq'), i++);
			else if (c === "'") ((mode = 'sq'), i++);
			else if (line.startsWith('-8<-', i)) return void (mode = 'cut');
			else if (c === '[') {
				const close = line.lastIndexOf(']');
				if (close <= i) return void (mode = 'macro');
				i = close + 1;
			} else i++;
		}
	});
	return out;
}

const KEYWORDS = Object.keys(KEYWORD_VALUE_KIND).filter(
	(k) => !['gapduration', 'gaplength'].includes(k),
);
const STATEMENT = new RegExp(`^\\s*(?:[a-zA-Z_]\\w*:)?(${KEYWORDS.join('|')})\\s+(\\S.*)$`);

interface Case {
	where: string;
	keyword: string;
	/** The rest of the statement's line, then the following lines. */
	text: string;
	more: readonly string[];
}
/** Deliberately broken inputs, checked on their own below. */
const NEGATIVE = ['tests/fixtures/tjp/neg-', 'synthetic/19-errors-parse/lib/broken.tji'];

const cases: Case[] = [];
const negative: Case[] = [];
for (const file of FILES) {
	const all = read(file).split('\n');
	for (const [n, line] of codeLines(read(file))) {
		const m = STATEMENT.exec(line);
		if (!m || /\$[{(]|[{}]|,\s*(#.*)?$/.test(line)) continue;
		const c = {
			where: `${file}:${n}`,
			keyword: m[1] ?? '',
			text: m[2] ?? '',
			more: all.slice(n, n + 40),
		};
		(NEGATIVE.some((p) => file.includes(p)) ? negative : cases).push(c);
	}
}

/**
 * Parses a case. A value left unterminated at the end of its line (a cut-here or multi-line
 * string, a block comment) takes in the following lines; it then ends where the next statement
 * starts, as it does in the grammar.
 */
function parseCase(c: Case) {
	const kind = KEYWORD_VALUE_KIND[c.keyword] ?? 'string';
	let text = `${c.text}\n`;
	let extra = 0;
	for (;;) {
		const r = parseValue(kind, text);
		if (r.ok) return { kind, r };
		if (r.error.code === 'unterminated' && extra < c.more.length) {
			text += `${c.more[extra++]}\n`;
		} else if (r.error.code === 'trailing-text' && extra > 0) {
			return { kind, r: parseValue(kind, text.slice(0, r.error.from)) };
		} else {
			return { kind, r };
		}
	}
}

describe('corpus statements', () => {
	it('finds a broad sample', () => {
		expect(FILES.length).toBeGreaterThan(100);
		expect(cases.length).toBeGreaterThan(2000);
		expect(new Set(cases.map((c) => c.keyword)).size).toBeGreaterThan(20);
	});

	it('fails the deliberately broken values where TaskJuggler does', () => {
		const codes = negative.map((c) => {
			const { r } = parseCase(c);
			return r.ok ? 'ok' : `${r.error.code}@${c.text.slice(r.error.from)}`;
		});
		// neg-junk-after-cut: "The cut mark -8<- must be immediately followed by a line break."
		expect(codes).toContain('junk-after-cut@-8<- junk');
		// syn-19 broken.tji:6: "Unexpected token '@' found" (golden message, line 6).
		expect(codes).toContain('trailing-text@@@ 2d');
	});

	it('parses every value and prints it with the same meaning', () => {
		const failures: string[] = [];
		for (const c of cases) {
			const { kind, r } = parseCase(c);
			if (!r.ok) {
				failures.push(`${c.where} ${c.keyword} ${JSON.stringify(c.text)}: ${r.error.code}`);
				continue;
			}
			const p = printValue(r.value);
			const back = p.ok ? parseValue(kind, p.value) : null;
			if (!back?.ok || !sameValue(back.value, r.value))
				failures.push(`${c.where}: print round trip`);
		}
		expect(failures).toEqual([]);
	});
});

describe('golden date semantics', () => {
	const zones = createTimeZoneHost();
	const iso = (s: string): number => {
		const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)Z$/.exec(s);
		if (!m) throw new Error(s);
		const [y, mo, d, h, mi, se] = m.slice(1).map(Number) as [
			number,
			number,
			number,
			number,
			number,
			number,
		];
		return utcSeconds({ year: y, month: mo, day: d, hour: h, minute: mi, second: se });
	};
	const checked = goldens.filter(
		(g) => expected(g.id).result.project !== null && !g.entry.includes('f-20'),
	);

	it.each(checked.map((g) => [g.id, g] as const))('%s', (_id, g) => {
		const lines = read(`${g.root}/${g.entry}`).split('\n');
		const project = expected(g.id).result.project;
		if (project === null) return;
		const header = lines.find((l) => /^\s*project\b/.test(l)) ?? '';
		const ivText = header.slice(header.search(/\d{4}-\d{1,2}-\d{1,2}/)).replace(/\{\s*$/, '');
		const iv = parseInterval(ivText);
		if (!iv.ok) throw new Error(`${g.id}: header ${iv.error.code}`);
		// The header is read before any timezone statement, so in UTC with the default resolution.
		expect(resolveInterval(iv.value, projectContext({}))).toEqual({
			ok: true,
			value: [iso(project.start), iso(project.end)],
		});

		const nowAt = lines.findIndex((l) => /^\s*now\s/.test(l));
		if (nowAt < 0) return;
		const zoneLine = lines
			.slice(0, nowAt)
			.filter((l) => /^\s*timezone\s/.test(l))
			.pop();
		const zone = zoneLine ? (/"([^"]+)"/.exec(zoneLine)?.[1] ?? null) : null;
		const res = lines.slice(0, nowAt).find((l) => /^\s*timingresolution\s/.test(l));
		const granularity = res ? Number(/(\d+)/.exec(res)?.[1]) * 60 : 3600;
		const now = parseDate((lines[nowAt] ?? '').replace(/^\s*now\s/, ''));
		if (!now.ok) throw new Error(`${g.id}: now ${now.error.code}`);
		expect(resolveDate(now.value, projectContext({ zone, zones, granularity }))).toEqual({
			ok: true,
			value: iso(project.now),
		});
	});
});
