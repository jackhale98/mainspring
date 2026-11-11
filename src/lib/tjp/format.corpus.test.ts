// SPDX-License-Identifier: GPL-2.0-or-later
// Format on demand over the corpora (phase-1.md 7.3, 9.4): every golden plan file, every T16
// fixture and the upstream Syntax/Correct files format to text that (a) differs only in blanks and
// tabs at the start and end of lines, (b) parses to the same tree shape and tokens, and (c) is a
// fixed point. A fast-check property damages the indentation and trailing blanks of corpus files
// and checks that formatting gives the same text as formatting the original.
// format.schedule.test.ts checks that formatted golden plans still schedule identically.
import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import type { Tree } from '@lezer/common';
import { describe, expect, it } from 'vitest';
import { CORPORA, NEGATIVE, ROOT, readTjp } from '../../../tests/grammar/corpus';
import { createWorkspace } from '../workspace/workspace';
import { changeSetOf, createFile, printTree, syntaxIssues, type TjpFile } from './document';
import {
	analyzeLines,
	detectIndentUnit,
	formatFile,
	indentOf,
	sameShape,
	type FormatOptions,
} from './format';

interface Case {
	/** Repository path of the file. */
	readonly name: string;
	readonly file: TjpFile;
}

function golden(): Case[] {
	const manifest = JSON.parse(
		fs.readFileSync(path.join(ROOT, 'engine/golden/manifest.json'), 'utf8'),
	) as Array<{ id: string; root: string }>;
	return manifest.flatMap((plan) => {
		const g = JSON.parse(
			fs.readFileSync(path.join(ROOT, 'engine/golden/expected', `${plan.id}.json`), 'utf8'),
		) as { entry: string; files: string[] };
		const files: Record<string, string> = {};
		for (const f of g.files) files[f] = readTjp(`${plan.root}/${f}`);
		return workspaceCases(plan.root, g.entry, files);
	});
}

function fixtures(): Case[] {
	const root = 'tests/fixtures/tjp';
	const all = CORPORA.find((c) => c.name === 'fixtures')?.files ?? [];
	return fs
		.readdirSync(path.join(ROOT, root), { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.flatMap((d) => {
			const dir = `${root}/${d.name}`;
			const files: Record<string, string> = {};
			for (const f of all) if (f.startsWith(`${dir}/`)) files[f.slice(dir.length + 1)] = readTjp(f);
			return workspaceCases(dir, 'plan.tjp', files);
		});
}

/** Each file of a workspace, parsed in the context its include site gives it. */
function workspaceCases(root: string, entry: string, files: Record<string, string>): Case[] {
	const snap = createWorkspace({ entry, files }).snapshot();
	return [...snap.files].map(([p, file]) => ({ name: `${root}/${p}`, file }));
}

/** Syntax/Correct files that parse without errors at the top level. */
function syntaxCorrect(): Case[] {
	const files = CORPORA.find((c) => c.name === 'Syntax/Correct')?.files ?? [];
	return files
		.map((f) => ({ name: f, file: createFile(f, readTjp(f)) }))
		.filter((c) => syntaxIssues(c.file.tree, c.file.text).length === 0);
}

const CASES: readonly Case[] = [...golden(), ...fixtures(), ...syntaxCorrect()];
const VALID = CASES.filter((c) => !NEGATIVE.has(c.name));

/** The formatted text of a file; throws on a refusal. */
function formatted(file: TjpFile, opts?: FormatOptions): string {
	const r = formatFile(file, opts);
	if (r.status !== 'format') throw new Error(`${file.path}: refused (${r.reason})`);
	return changeSetOf([...r.changes], file.text.length)
		.apply(file.text)
		.toString();
}

/** Lines with their leading and trailing blanks and tabs removed (a final `\r` kept). */
function cores(text: string): string[] {
	return text.split('\n').map((l) => l.replace(/^[ \t]*/, '').replace(/[ \t]*(\r?)$/, '$1'));
}

/** Leaf names and texts; comments without trailing blanks on each line. */
function leaves(tree: Tree, text: string): string[] {
	const out: string[] = [];
	tree.iterate({
		enter(n) {
			if (n.node.firstChild) return;
			let t = text.slice(n.from, n.to);
			if (n.name.endsWith('Comment')) t = t.replace(/[ \t]+(\r?)(?=\n|$)/g, '$1');
			out.push(`${n.name}:${t}`);
		},
	});
	return out;
}

describe('format over the corpora', () => {
	it('covers the corpora', () => {
		expect(CASES.length).toBeGreaterThan(150);
		expect(
			CASES.filter((c) => NEGATIVE.has(c.name))
				.map((c) => c.name)
				.sort(),
		).toEqual([...NEGATIVE.keys()].sort());
	});

	it('refuses the files with syntax errors', () => {
		for (const c of CASES.filter((x) => NEGATIVE.has(x.name))) {
			const r = formatFile(c.file);
			expect(r.status, c.name).toBe('refused');
			if (r.status === 'refused') expect(r.reason).toBe('syntax-error');
		}
	});

	it.each(VALID.map((c) => [c.name, c] as const))('%s', (_name, { file }) => {
		const old = file.text.toString();
		const next = formatted(file);
		// (a) only blanks and tabs at line starts and ends change; line endings stay.
		expect(cores(next)).toEqual(cores(old));
		const after = createFile(file.path, next, file.top);
		expect(printTree(after.tree, next)).toBe(next);
		// (b) same tree shape, same tokens.
		expect(syntaxIssues(after.tree, after.text)).toEqual([]);
		expect(sameShape(file.tree, after.tree)).toBe(true);
		expect(leaves(after.tree, next)).toEqual(leaves(file.tree, old));
		// (c) a fixed point, with the same unit.
		expect(detectIndentUnit(after)).toBe(detectIndentUnit(file));
		expect(formatted(after)).toBe(next);
	});

	it('changes some corpus files and leaves macro bodies byte for byte', () => {
		let changed = 0;
		for (const { file } of VALID) {
			const old = file.text.toString();
			const next = formatted(file);
			if (next !== old) changed++;
			const bodies = (t: string): string[] => t.match(/\[[^\]]*\]\n/g) ?? [];
			expect(bodies(next).length).toBe(bodies(old).length);
		}
		expect(changed).toBeGreaterThan(0);
	});
});

/** Damage: per line index, new indentation for formatter-computed lines, trailing blanks. */
const BLANKS = fc.constantFrom('', ' ', '  ', '   ', '\t', '    ', '\t\t', ' \t', '        ');
const damage = fc.array(fc.tuple(fc.nat(), BLANKS, fc.constantFrom('', ' ', '\t', '  \t')), {
	maxLength: 40,
});

/**
 * The file with damaged lines: an `absolute` or `blank` line gets new indentation, and the
 * continuation lines anchored to it move with it; trailing blanks go where format strips them.
 * Anchors of continuation lines that format aligns by columns are not damaged.
 */
function damaged(file: TjpFile, picks: ReadonlyArray<readonly [number, string, string]>): string {
	const infos = analyzeLines(file);
	const lines = file.text.toString().split('\n');
	const pinned = new Set<number>();
	infos.forEach((info, i) => {
		if (info.kind !== 'continuation') return;
		const anchor = indentOf(lines[info.anchor - 1] ?? '');
		if (!indentOf(lines[i] ?? '').startsWith(anchor)) pinned.add(info.anchor - 1);
	});
	const lead = new Map<number, string>();
	const tail = new Map<number, string>();
	for (const [n, ws, t] of picks) {
		const i = n % lines.length;
		const info = infos[i];
		if ((info?.kind === 'absolute' || info?.kind === 'blank') && !pinned.has(i)) lead.set(i, ws);
		// Blanks after a macro body's `]` would keep it open (scanner.ts), so none go there.
		const closesMacro = /\]\r?$/.test(lines[i] ?? '');
		if (info?.stripTrailing && info.kind !== 'blank' && !closesMacro) tail.set(i, t);
	}
	const out: string[] = [];
	lines.forEach((line, i) => {
		const info = infos[i];
		const old = indentOf(line);
		let ws = lead.get(i) ?? old;
		if (info?.kind === 'continuation') {
			const anchorOld = indentOf(lines[info.anchor - 1] ?? '');
			const anchorNew =
				out[info.anchor - 1] === undefined ? anchorOld : indentOf(out[info.anchor - 1] ?? '');
			if (old.startsWith(anchorOld)) ws = anchorNew + old.slice(anchorOld.length);
		}
		let rest = line.slice(old.length);
		const t = tail.get(i);
		if (t !== undefined) {
			const cr = rest.endsWith('\r') ? '\r' : '';
			rest = rest.slice(0, rest.length - cr.length) + t + cr;
		}
		out.push(ws + rest);
	});
	return out.join('\n');
}

describe('format property', () => {
	const runs = Number(process.env['FORMAT_RUNS'] ?? 200);
	it('formats damaged indentation to the same text as the original', () => {
		fc.assert(
			fc.property(fc.nat({ max: VALID.length - 1 }), damage, (k, picks) => {
				const c = VALID[k];
				if (!c) return;
				const unit = detectIndentUnit(c.file);
				const want = formatted(c.file, { unit });
				const text = damaged(c.file, picks);
				const hurt = createFile(c.file.path, text, c.file.top);
				fc.pre(sameShape(hurt.tree, c.file.tree));
				expect(formatted(hurt, { unit }), c.name).toBe(want);
			}),
			{ numRuns: runs },
		);
	}, 120_000);
});
