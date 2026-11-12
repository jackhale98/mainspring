// SPDX-License-Identifier: GPL-2.0-or-later
// Prints a whole MPlan: the entry file's header, macros, flags, resources and includes around the tasks
// that printer.ts writes, and collects the oracle's facts (see printer.ts).
import type { BodyF, Elem, Facts, ItemF, ProjF, StmtF, TaskF } from './facts';
import { type MPlan, type MRes, preOrder } from './model';
import { Buf, Printer } from './printer';
import type { Rng } from './rng';

/** The text of every file and what the printer recorded. */
export interface Printed {
	files: Record<string, string>;
	facts: Facts;
}

export function printPlan(plan: MPlan, rng: Rng): Printed {
	const p = new Printer(plan, rng);
	const entry = p.bufs[0] as Buf;
	const eol = plan.eol;
	const top = (b: Buf, key: string, kind: 'stmt' | 'block', from: number): void => {
		b.tops.push({ kind, key, from, to: b.text.length - eol.length, start: from });
	};
	const end = `+${plan.horizon}m`;
	let from = entry.pos;
	entry.put(`# Fidelity plan ${plan.seed}${eol}`);
	from = entry.pos;
	const pseq = p.seq++;
	entry.put('project fid ');
	const nfrom = entry.pos;
	entry.put('"Fidelity plan"');
	const pnameAt = p.rg(entry, nfrom, entry.pos);
	entry.put(' ');
	const sfrom = entry.pos;
	entry.put('2026-01-05');
	const startAt = p.rg(entry, sfrom, entry.pos);
	entry.put(' ');
	const efrom = entry.pos;
	entry.put(end);
	const endAt = p.rg(entry, efrom, entry.pos);
	const pstmts: StmtF[] = [];
	let pbody: BodyF | null = null;
	if (plan.projectStmts.length > 0 || plan.scenarios) {
		entry.put(' {');
		const body = { file: entry.path, open: entry.pos, close: 0, elems: [] as Elem[] };
		pbody = body;
		entry.put(eol);
		for (const st of plan.projectStmts) pstmts.push(p.stmt(entry, 1, st, null, body, 'decl'));
		if (plan.scenarios) {
			const sf = entry.pos + plan.indent.length;
			entry.put(`${plan.indent}scenario plan "Plan" { scenario late "Late" }${eol}`);
			body.elems.push({ kind: 'stmt', key: null, from: sf, to: entry.pos - eol.length, start: sf });
		}
		body.close = entry.pos;
		entry.put(`}${eol}`);
	} else entry.put(eol);
	const pend = pbody ? pbody.close + 1 : endAt.to;
	const project: ProjF = {
		id: 'project',
		parent: null,
		children: [],
		name: 'Fidelity plan',
		nameAt: pnameAt,
		nameMacro: false,
		seq: pseq,
		block: p.rg(entry, from, pend),
		start: 0, // the comment line above the header is attached
		body: pbody,
		stmts: pstmts,
		macroWords: new Set(),
		frameAt: { start: startAt, end: endAt },
	};
	entry.tops.push({ kind: 'block', key: 'project', from, to: pend, start: from });
	for (const m of plan.macros) {
		from = entry.pos;
		entry.put(`macro ${m.name} [`);
		const mfrom = entry.pos - 1;
		entry.put(m.multiline ? `${eol}      ${m.body.trim()}  ${eol}  ` : m.body);
		entry.put(']');
		p.macroRanges.push(p.rg(entry, mfrom, entry.pos));
		if (m.multiline) p.noTouch.push(p.rg(entry, mfrom, entry.pos));
		entry.put(eol);
		top(entry, 'macro', 'stmt', from);
	}
	for (const decl of plan.flagDecls) {
		from = entry.pos;
		const seq = p.seq++;
		entry.put('flags ');
		const vfrom = entry.pos;
		const items: ItemF[] = decl.map((name, i) => {
			if (i > 0) entry.put(', ');
			const f = entry.pos;
			entry.put(name);
			const at = p.rg(entry, f, entry.pos);
			return { written: name, target: name, at, range: at, gap: null };
		});
		const range = p.rg(entry, from, entry.pos);
		const value = p.rg(entry, vfrom, entry.pos);
		p.flagDecls.push({
			key: 'flags',
			scenario: null,
			site: 'decl',
			seq,
			range,
			value,
			text: entry.text.slice(vfrom),
			items,
			macro: false,
			body: null,
		});
		entry.put(eol);
		top(entry, 'flags', 'stmt', from);
	}
	for (const st of plan.globalLeaves) {
		from = entry.pos;
		p.globalLeaves.push(p.stmt(entry, 0, st, null, null, 'decl'));
		top(entry, 'leaves', 'stmt', from);
	}
	plan.resources.forEach((r) => p.resource(r, null, 0));

	const include = (k: number, prefix: string | null): void => {
		from = entry.pos;
		entry.put(`include "${plan.files[k]?.path}"${prefix ? ` { taskprefix ${prefix} }` : ''}${eol}`);
		top(entry, 'include', 'stmt', from);
	};
	const done = new Set<number>();
	plan.tasks.forEach((t, i) => {
		if (t.file === 0) {
			p.task(t, 0, i === 0);
			plan.files.forEach((f, k) => {
				if (f.prefix !== t.id) return;
				include(k, t.id);
				t.kids.filter((c) => c.file === k).forEach((c, j) => p.task(c, 0, j === 0));
				p.supplements(k);
			});
		} else if (!done.has(t.file)) {
			done.add(t.file);
			include(t.file, null);
			plan.tasks.filter((u) => u.file === t.file).forEach((u, j) => p.task(u, 0, j === 0));
			p.supplements(t.file);
		}
	});
	p.supplements(0);

	const tasks = preOrder(plan.tasks).map((m) => p.tasks.find((x) => x.id === m.id) as TaskF);
	const resOrder = (rs: readonly MRes[]): string[] =>
		rs.flatMap((r) => [r.id, ...resOrder(r.kids)]);
	const resTree = resOrder(plan.resources).map((id) => p.resTree.find((x) => x.id === id) as TaskF);
	const files: Record<string, string> = {};
	const topElems: Record<string, Elem[]> = {};
	for (const b of p.bufs) {
		files[b.path] = b.text;
		topElems[b.path] = [...b.tops].sort((x, y) => x.from - y.from);
	}
	const facts: Facts = {
		entry: plan.files[0]?.path ?? 'plan.tjp',
		texts: files,
		tasks,
		byId: new Map(tasks.map((t) => [t.id, t])),
		resTree,
		resById: new Map(resTree.map((r) => [r.id, r])),
		project,
		globalLeaves: p.globalLeaves,
		frameDates: true,
		flagDecls: p.flagDecls,
		topElems,
		macroRanges: p.macroRanges,
		noTouch: p.noTouch,
		// TaskJuggler reads +Nm as N months of 365/12 days.
		frame: {
			start: Date.UTC(2026, 0, 5) / 1000,
			end: Date.UTC(2026, 0, 5) / 1000 + plan.horizon * 2628000,
		},
	};
	return { files, facts };
}
