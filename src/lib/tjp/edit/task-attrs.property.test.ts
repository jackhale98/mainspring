// SPDX-License-Identifier: GPL-2.0-or-later
// Task attribute intents over the corpora (phase-1.md 9.3 P1, P2, P3, P5, P6, text only): random
// setAttr, removeAttr, renameTask and declareFlag intents on random tasks of every golden plan
// and T16 fixture (CRLF, lone CR, tabs, supplements, scenario prefixes, macros, prefixed
// includes). For every outcome:
// - refusals and no-ops change nothing; an edit changes text only inside its declared targets,
//   every target lies in the statement or block the intent names (the task's declaration and
//   supplement blocks, a file-level `flags` statement or the insertion line), and the inverse
//   restores the base byte for byte;
// - the new text has no new error nodes, and the rebuilt index reads the intended value: the
//   last top-scenario site's value, no own site after removeAttr, the new name, the new flag;
// - edits never touch a macro node (touchedMacro).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createWorkspace } from '../../workspace/workspace';
import { createFile, syntaxIssues } from '../document';
import { buildIndex, lastSite, type TaskSymbol } from '../index';
import { KEYWORD_VALUE_KIND, parseString, parseValue, sameValue } from '../values';
import { applyIntent } from './apply';
import { touchedMacro } from './oracle';
import { attrCorpora, intentFor, type AttrCorpus as Corpus } from './task-attrs-testing';
import type { EditIntent, EditResult, Span } from './types';

const CORPUS = attrCorpora();

/** Whether the union of `outer` covers `r` (adjacent changes coalesce into one range). */
function within(r: Span, outer: readonly Span[]): boolean {
	let at = r.from;
	for (const o of [...outer].sort((a, b) => a.from - b.from)) {
		if (o.from <= at && o.to >= at) at = Math.max(at, o.to);
	}
	return at >= r.to && outer.some((o) => o.from <= r.from && r.from <= o.to);
}

/** The oracle regions an intent may change, per file (from the pre-edit index). */
function regions(c: Corpus, intent: EditIntent): Map<string, Span[]> {
	const out = new Map<string, Span[]>();
	const add = (file: string, s: Span): void => {
		const text = c.snap.files.get(file)?.text.toString() ?? '';
		let from = s.from;
		while (from > 0 && text[from - 1] !== '\n' && text[from - 1] !== '\r') from--;
		let to = s.to;
		while (to < text.length && text[to] !== '\n' && text[to] !== '\r') to++;
		if (text.startsWith('\r\n', to)) to += 2;
		else if (to < text.length) to++;
		out.set(file, [...(out.get(file) ?? []), { from, to }]);
	};
	if (intent.type === 'declareFlag') {
		for (const f of c.index.globalFlags) add(f.statement.file, f.statement);
		const first = c.index.tasks.get(c.index.taskRoots[0] ?? '');
		// Before the first task: after the end of the top-level statement above it.
		if (first) {
			const b = first.decl.block;
			const top = c.snap.files.get(b.file)?.tree.topNode;
			let p = 0;
			for (let n = top?.firstChild; n && n.to <= b.from; n = n.nextSibling) {
				if (n.name.endsWith('Statement')) p = n.to;
			}
			add(b.file, { from: p, to: b.from });
		}
		return out;
	}
	const id =
		intent.type === 'setAttr' || intent.type === 'removeAttr' || intent.type === 'renameTask'
			? intent.task
			: null;
	const sym = id === null ? undefined : c.index.tasks.get(id);
	if (!sym) return out;
	for (const b of [sym.decl.block, ...sym.supplements.map((s) => s.block)]) add(b.file, b);
	return out;
}

function check(c: Corpus, intent: EditIntent, r: EditResult): void {
	if (r.status !== 'edit') return;
	const files = new Map<string, string>();
	const allowed = regions(c, intent);
	for (const [p, f] of c.snap.files) files.set(p, f.text.toString());
	for (const [p, cs] of Object.entries(r.edit.changes)) {
		const file = c.snap.files.get(p);
		if (!file) throw new Error(`edit of unknown file ${p}`);
		const targets = r.edit.targets[p] ?? [];
		cs.iterChangedRanges((fromA, toA) => {
			expect(within({ from: fromA, to: toA }, targets), `${c.name} ${p} ${fromA}`).toBe(true);
		});
		for (const t of targets) expect(within(t, allowed.get(p) ?? []), `${c.name} ${p}`).toBe(true);
		const next = cs.apply(file.text);
		const inv = r.edit.inverse[p];
		expect(inv?.apply(next).toString()).toBe(file.text.toString());
		const nf = createFile(p, next.toString(), file.top);
		expect(syntaxIssues(nf.tree, nf.text).length).toBeLessThanOrEqual(
			syntaxIssues(file.tree, file.text).length,
		);
		expect(touchedMacro(file.tree, file.text.toString(), nf.tree, cs)).toBeNull();
		files.set(p, next.toString());
	}
	const snap = createWorkspace({
		entry: c.snap.entry,
		files: Object.fromEntries(files),
	}).snapshot();
	const index = buildIndex(snap);
	const top = index.scenarios[0]?.id ?? null;
	if (intent.type === 'declareFlag') {
		expect(index.flags.has(intent.flag)).toBe(true);
		return;
	}
	if (intent.type !== 'setAttr' && intent.type !== 'removeAttr' && intent.type !== 'renameTask') {
		return;
	}
	const sym: TaskSymbol | undefined = index.tasks.get(intent.task);
	expect(sym, `${c.name} ${intent.task}`).toBeDefined();
	if (!sym) return;
	if (intent.type === 'renameTask') {
		const n = sym.decl.name;
		const written = n && snap.files.get(n.file)?.text.sliceString(n.from, n.to);
		const parsed = written ? parseString(written) : null;
		expect(parsed?.ok && parsed.value).toBe(intent.name);
		return;
	}
	if (intent.type !== 'setAttr' && intent.type !== 'removeAttr') return;
	const site = lastSite(sym.attrs, intent.attr, null, top);
	if (intent.type === 'removeAttr' || intent.value === false) {
		expect(site).toBeNull();
		return;
	}
	expect(site, `${c.name} ${intent.task} ${intent.attr}`).not.toBeNull();
	if (typeof intent.value !== 'string' || !site?.value) return;
	const kind = KEYWORD_VALUE_KIND[intent.attr];
	const want = kind ? parseValue(kind, intent.value) : null;
	const text = snap.files.get(site.value.file)?.text.sliceString(site.value.from, site.value.to);
	const got = kind && text !== undefined ? parseValue(kind, text) : null;
	expect(want?.ok && got?.ok && sameValue(want.value, got.value)).toBe(true);
	if (['effort', 'length', 'duration'].includes(intent.attr)) {
		const sizing = sym.attrs.filter(
			(a) =>
				['effort', 'length', 'duration'].includes(a.keyword) &&
				(a.scenario === null || a.scenario === top),
		);
		expect(sizing.every((a) => a.keyword === intent.attr)).toBe(true);
	}
}

describe('task attribute intents on the corpora', () => {
	it('loads golden plans and fixtures', () => {
		expect(CORPUS.length).toBeGreaterThan(40);
	});

	it('edit only their targets, invert exactly, parse, and read back the intended value', () => {
		const counts = new Map<string, number>();
		fc.assert(
			fc.property(
				fc.record({
					ci: fc.nat(CORPUS.length - 1),
					kind: fc.nat(4),
					pick: fc.nat(),
					value: fc.nat(1000),
				}),
				({ ci, kind, pick, value }) => {
					const c = CORPUS[ci];
					if (!c) return;
					const intent = intentFor(c, kind, pick, value);
					const r = applyIntent(c.snap, c.index, intent);
					const key = `${intent.type}:${r.status}:${r.status === 'edit' ? '' : r.reason}`;
					counts.set(key, (counts.get(key) ?? 0) + 1);
					check(c, intent, r);
				},
			),
			{ numRuns: 400 },
		);
		console.log(`task attribute intents: ${JSON.stringify([...counts].sort())}`);
		for (const t of ['setAttr', 'removeAttr', 'renameTask', 'declareFlag']) {
			expect(counts.get(`${t}:edit:`) ?? 0, t).toBeGreaterThanOrEqual(5);
		}
	});
});
