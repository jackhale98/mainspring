// SPDX-License-Identifier: GPL-2.0-or-later
// The oracle of the fidelity suite is itself tested: what the printer records must be what it wrote,
// the printer's record and the index must agree on every range, the generated plans must parse
// cleanly, and the zones must fall where 7.2 puts new text.
import { describe, expect, it } from 'vitest';
import { buildIndex } from '../../src/lib/tjp/index';
import { syntaxIssues } from '../../src/lib/tjp/tree';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import { attachedFrom, factsFromIndex } from './oracle';
import {
	bodyInsertZone,
	canonSem,
	declareFlagZone,
	insertZone,
	removeZone,
	semOf,
	type Facts,
	type Rg,
} from './gen/facts';
import { genPlan } from './gen/model';
import { printPlan } from './gen/print-plan';
import { Rng } from './gen/rng';

const slice = (f: Facts, r: Rg): string => (f.texts[r.file] ?? '').slice(r.from, r.to);
const plans = (n: number): Array<{ seed: number; files: Record<string, string>; facts: Facts }> =>
	Array.from({ length: n }, (_, i) => {
		const rng = new Rng(i + 101);
		const plan = genPlan(rng, i % 4 === 0 ? { sloppy: true } : {});
		return { seed: i + 101, ...printPlan(plan, rng) };
	});

describe('the printer records what it wrote', () => {
	it('every recorded range slices to its element', () => {
		for (const { seed, facts } of plans(120)) {
			for (const t of facts.tasks) {
				expect(slice(facts, t.block), `${seed} ${t.id}`).toMatch(/^task \w+ /);
				if (t.nameAt) expect(slice(facts, t.nameAt)).toMatch(/^(".*"|'.*')$/s);
				if (t.body) {
					const text = facts.texts[t.body.file] ?? '';
					expect(text[t.body.open - 1]).toBe('{');
					expect(text[t.body.close]).toBe('}');
				}
				for (const s of t.stmts) {
					expect(slice(facts, s.range), `${seed} ${t.id}`).toMatch(
						new RegExp(`^(\\w+:)?${s.key}\\b`),
					);
					for (const i of s.items ?? []) expect(slice(facts, i.at)).toBe(i.written);
				}
			}
		}
	});

	it('the index reads the same ranges and values the printer recorded', () => {
		for (const { seed, files, facts } of plans(120)) {
			const snap = createWorkspace({ entry: 'plan.tjp', files }).snapshot();
			expect(
				[...snap.files.values()].flatMap((f) => syntaxIssues(f.tree, f.text)),
				`${seed} parse`,
			).toEqual([]);
			const index = buildIndex(snap, undefined, { cache: null });
			const read = factsFromIndex(snap, index);
			expect(JSON.stringify(canonSem(semOf(read))), `${seed} semantics`).toBe(
				JSON.stringify(canonSem(semOf(facts))),
			);
			for (const t of facts.tasks) {
				const r = read.byId.get(t.id);
				expect(r?.block, `${seed} ${t.id} block`).toEqual(t.block);
				expect(r?.nameAt, `${seed} ${t.id} name`).toEqual(t.nameAt);
				expect(r?.start, `${seed} ${t.id} start`).toBe(t.start);
				expect(r?.body?.open, `${seed} ${t.id} open`).toBe(t.body?.open);
				expect(r?.body?.close, `${seed} ${t.id} close`).toBe(t.body?.close);
				expect(
					r?.body?.elems.map((e) => [e.kind, e.from, e.to, e.start]),
					`${seed} ${t.id} elems`,
				).toEqual(t.body?.elems.map((e) => [e.kind, e.from, e.to, e.start]));
				const byStart = (xs: readonly { range: Rg; value: Rg | null }[]): unknown[] =>
					xs.map((s) => [s.range.file, s.range.from, s.range.to, s.value?.from, s.value?.to]);
				expect(byStart(r?.stmts ?? []), `${seed} ${t.id} statements`).toEqual(byStart(t.stmts));
			}
		}
	});

	it('includes, prefixes, macros, supplements and scenarios all occur', () => {
		const seen = {
			files: 0,
			prefix: 0,
			macro: 0,
			supp: 0,
			scenario: 0,
			crlf: 0,
			tab: 0,
			oneLine: 0,
		};
		for (const { files, facts } of plans(200)) {
			if (Object.keys(files).length > 1) seen.files++;
			if (Object.values(files).some((t) => /include "[^"]+" \{ taskprefix/.test(t))) seen.prefix++;
			if (facts.macroRanges.length > 0) seen.macro++;
			if (facts.tasks.some((t) => t.stmts.some((s) => s.site === 'supp'))) seen.supp++;
			if (facts.tasks.some((t) => t.stmts.some((s) => s.scenario !== null))) seen.scenario++;
			if (Object.values(files).some((t) => t.includes('\r\n'))) seen.crlf++;
			if (Object.values(files).some((t) => /^\t/m.test(t))) seen.tab++;
			if (Object.values(files).some((t) => /\{ [a-z]+ .* \}/.test(t))) seen.oneLine++;
		}
		for (const [k, v] of Object.entries(seen)) expect(v, k).toBeGreaterThan(5);
	});
});

describe('zones follow 7.1 and 7.2', () => {
	const facts = (text: string): Facts => {
		const snap = createWorkspace({ entry: 'plan.tjp', files: { 'plan.tjp': text } }).snapshot();
		return factsFromIndex(snap, buildIndex(snap, undefined, { cache: null }));
	};
	const text = [
		'project p "P" 2026-01-05 +3m',
		'flags a',
		'resource r "R"',
		'task t "T" {',
		'  note "n"',
		'  # about effort',
		'  effort 1d',
		'  allocate r # who',
		'  task c "C"',
		'}',
		'',
	].join('\n');

	it('a new statement goes after the last statement of equal or lower rank', () => {
		const f = facts(text);
		const t = f.byId.get('t');
		if (!t) throw new Error('no task');
		const zone = (key: string): string => {
			const z = insertZone(f, t, key)[0] as Rg;
			return JSON.stringify([text.slice(z.from, z.to)]);
		};
		// priority ranks after note: between `note "n"` and the comment that belongs to effort.
		expect(zone('priority')).toBe(JSON.stringify(['\n  ']));
		// depends ranks after effort and before allocate.
		expect(zone('depends')).toBe(JSON.stringify(['\n  ']));
		const z = insertZone(f, t, 'depends')[0] as Rg;
		expect(text.slice(0, z.from).endsWith('effort 1d')).toBe(true);
		// complete ranks last, after allocate and its trailing comment, before the child task.
		const last = insertZone(f, t, 'complete')[0] as Rg;
		expect(text.slice(0, last.from).endsWith('allocate r')).toBe(true);
		expect(text.slice(last.to).startsWith('task c')).toBe(true);
		// A task without a body gets one at the end of its header.
		const c = f.byId.get('t.c');
		const hz = c ? (insertZone(f, c, 'effort')[0] as Rg) : null;
		expect(hz && text.slice(0, hz.from).endsWith('task c "C"')).toBe(true);
	});

	it('a statement on its own line is removed with its line', () => {
		const f = facts(text);
		const s = f.byId.get('t')?.stmts.find((x) => x.key === 'note');
		if (!s) throw new Error('no statement');
		const zones = removeZone(f, s);
		expect(zones.some((z) => text.slice(z.from, z.to) === '\n  note "n"\n')).toBe(true);
	});

	it('declareFlag appends to the flags declaration before the first task', () => {
		const f = facts(text);
		const z = declareFlagZone(f)[0] as Rg;
		expect(text.slice(z.from, z.to)).toBe('');
		expect(text.slice(0, z.from).endsWith('flags a')).toBe(true);
		const bare = facts(text.replace('flags a\n', ''));
		const b = declareFlagZone(bare)[0] as Rg;
		expect(bare.texts['plan.tjp']?.slice(b.to).startsWith('task t')).toBe(true);
	});

	it('comment lines directly above a statement belong to it', () => {
		expect(attachedFrom(text, text.indexOf('effort 1d'))).toBe(text.indexOf('# about effort'));
		expect(attachedFrom(text, text.indexOf('allocate r'))).toBe(text.indexOf('allocate r'));
		const f = facts(text);
		const body = f.byId.get('t')?.body;
		const z = body ? bodyInsertZone(body, 9) : null;
		expect(z && text.slice(z.to).startsWith('# about effort')).toBe(true);
	});
});
