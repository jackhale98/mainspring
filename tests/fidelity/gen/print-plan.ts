// SPDX-License-Identifier: GPL-2.0-or-later
// Prints a whole MPlan: the entry file's header, macros, flags, resources and includes around the tasks
// that printer.ts writes, and collects the oracle's facts (see printer.ts).
import type { Elem, Facts, ItemF, TaskF } from './facts';
import { type MPlan, preOrder } from './model';
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
	entry.put(`project fid "Fidelity plan" 2026-01-05 ${end}`);
	if (plan.headerBody || plan.scenarios) {
		entry.put(` {${eol}${plan.indent}now 2026-01-05-09:00${eol}`);
		if (plan.scenarios)
			entry.put(`${plan.indent}scenario plan "Plan" { scenario late "Late" }${eol}`);
		entry.put(`}${eol}`);
	} else entry.put(eol);
	top(entry, 'project', 'block', from);
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
	if (plan.globalLeaves) {
		from = entry.pos;
		entry.put(`leaves ${plan.globalLeaves}${eol}`);
		p.leaves.push(`global|${plan.globalLeaves}`);
		top(entry, 'leaves', 'stmt', from);
	}
	const res = (r: (typeof plan.resources)[number], parent: string | null, d: number): void => {
		const ind = plan.indent.repeat(d);
		const f = entry.pos;
		entry.put(`${ind}resource ${r.id} "${r.name}"`);
		p.resources.push({ id: r.id, parent });
		if (r.kids.length === 0 && !r.leaves) entry.put(eol);
		else {
			entry.put(` {${eol}`);
			if (r.leaves) {
				entry.put(`${ind}${plan.indent}leaves ${r.leaves}${eol}`);
				p.leaves.push(`res:${r.id}|${r.leaves}`);
			}
			r.kids.forEach((k) => res(k, r.id, d + 1));
			entry.put(`${ind}}${eol}`);
		}
		if (d === 0) top(entry, 'resource', 'block', f + ind.length);
	};
	plan.resources.forEach((r) => res(r, null, 0));

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
		resources: p.resources,
		flagDecls: p.flagDecls,
		topElems,
		macroRanges: p.macroRanges,
		noTouch: p.noTouch,
		leaves: p.leaves,
		frame: { start: Date.UTC(2026, 0, 5) / 1000, end: Date.UTC(2026, plan.horizon, 5) / 1000 },
	};
	return { files, facts };
}
