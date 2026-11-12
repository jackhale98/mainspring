// SPDX-License-Identifier: GPL-2.0-or-later
// Prints an MPlan as .tjp/.tji text with varied formatting (indent unit, one-line blocks, comments,
// attribute order, relative and absolute ids, wrapped lists, CRLF) and records the exact range of
// every element it writes. The record (`Facts`) is the oracle for generated plans: it does not
// come from the parser, the index or the edit code. This file prints tasks and supplements;
// print-plan.ts prints the file layout around them.
import type { BodyF, Elem, ItemF, Rg, StmtF, TaskF } from './facts';
import {
	BLOCK,
	preOrder,
	type MItem,
	type MPlan,
	type MRes,
	type MStmt,
	type MTask,
} from './model';
import type { Rng } from './rng';

type Mut<T> = { -readonly [K in keyof T]: T[K] };
type MBody = Mut<BodyF> & { elems: Elem[] };

export class Buf {
	text = '';
	readonly tops: Elem[] = [];
	constructor(readonly path: string) {}
	get pos(): number {
		return this.text.length;
	}
	put(s: string): void {
		this.text += s;
	}
}

export class Printer {
	readonly bufs: Buf[];
	readonly tasks: TaskF[] = [];
	readonly flagDecls: StmtF[] = [];
	readonly macroRanges: Rg[] = [];
	readonly noTouch: Rg[] = [];
	readonly resTree: TaskF[] = [];
	readonly globalLeaves: StmtF[] = [];
	seq = 0;
	constructor(
		readonly plan: MPlan,
		readonly rng: Rng,
	) {
		this.bufs = plan.files.map((f) => new Buf(f.path));
	}
	get eol(): string {
		return this.plan.eol;
	}
	/** Indentation for a line at depth `d`; with `sloppy`, some lines get the wrong one. */
	indent(d: number): string {
		const { plan, rng } = this;
		if (plan.sloppy && rng.chance(0.35)) {
			const k = rng.int(0, 3);
			if (k === 0) return '';
			if (k === 1) return plan.indent.repeat(d + 1);
			if (k === 2) return plan.indent.repeat(d) + ' ';
			return plan.indent.repeat(Math.max(0, d - 1)) + '   ';
		}
		return plan.indent.repeat(d);
	}
	rg(b: Buf, from: number, to: number): Rg {
		return { file: b.path, from, to };
	}

	/** A comment line (or a multi-line block comment) above an element; returns the start. */
	lead(b: Buf, d: number, lead: { text: string; attached: boolean } | null): number | null {
		if (!lead) return null;
		const ind = this.indent(d);
		b.put(ind);
		const from = b.pos;
		if (lead.text === BLOCK) {
			b.put(`/* first line${this.eol}${ind}   second line */`);
			this.noTouch.push(this.rg(b, from, b.pos));
		} else b.put(`# ${lead.text}`);
		b.put(this.eol);
		if (!lead.attached || lead.text === BLOCK) {
			b.put(this.eol);
			return null;
		}
		return from;
	}

	trail(text: string | null): string {
		return text === null ? '' : ` # ${text === BLOCK ? 'block' : text}`;
	}

	ref(t: MTask | null, target: string, rel: boolean): string {
		if (!rel || !t?.parent) return target;
		for (let a: MTask | null = t.parent, j = 0; a && j < 2; a = a.parent, j++) {
			if (target.startsWith(`${a.id}.`)) return '!'.repeat(j + 1) + target.slice(a.id.length + 1);
		}
		return target;
	}

	/** Prints one statement; returns its element and facts. */
	stmt(
		b: Buf,
		d: number,
		s: MStmt,
		owner: MTask | null,
		body: MBody | null,
		site: 'decl' | 'supp',
	): StmtF {
		const lead = this.lead(b, d, s.lead);
		b.put(this.indent(d));
		const f = this.stmtInline(b, d, s, owner, body, site);
		b.put(this.trail(s.trailing) + this.eol);
		if (body)
			body.elems.push({
				kind: 'stmt',
				key: s.key,
				from: f.range.from,
				to: f.range.to,
				start: lead ?? f.range.from,
				scoped: s.scenario !== null,
			});
		return f;
	}

	/** The statement text without indent or line break. */
	stmtInline(
		b: Buf,
		d: number,
		s: MStmt,
		owner: MTask | null,
		body: MBody | null,
		site: 'decl' | 'supp',
	): StmtF {
		const from = b.pos;
		const seq = this.seq++;
		b.put((s.scenario ? `${s.scenario}:` : '') + s.key);
		let value: Rg | null = null;
		let items: ItemF[] | null = null;
		let macro = false;
		if (s.items) {
			b.put(' ');
			const vfrom = b.pos;
			items = s.items.map((it, i) => {
				if (i > 0) b.put(s.wrap ? `,${this.eol}${this.indent(d + 1)}` : ', ');
				return this.item(b, owner, s, it);
			});
			value = this.rg(b, vfrom, b.pos);
		} else if (s.value !== null) {
			b.put(' ');
			const vfrom = b.pos;
			b.put(s.value);
			value = this.rg(b, vfrom, b.pos);
			macro = s.macro;
			if (macro) this.macroRanges.push(value);
		}
		const range = this.rg(b, from, b.pos);
		const text = value ? (b.text.slice(value.from, value.to) as string) : '';
		return { key: s.key, scenario: s.scenario, site, seq, range, value, text, items, macro, body };
	}

	item(b: Buf, owner: MTask | null, s: MStmt, it: MItem): ItemF {
		const written =
			s.key === 'depends' || s.key === 'precedes' ? this.ref(owner, it.target, it.rel) : it.target;
		const from = b.pos;
		b.put(written);
		const at = this.rg(b, from, b.pos);
		if (it.gap) b.put(` { ${it.gap.kind} ${it.gap.value} }`);
		return { written, target: it.target, at, range: this.rg(b, from, b.pos), gap: it.gap };
	}

	/** Prints a task and its inline children at depth `d`. */
	task(t: MTask, d: number, first: boolean): void {
		const b = this.bufs[t.file] as Buf;
		const { eol } = this;
		if (t.blankBefore && !first) b.put(eol);
		const lead = this.lead(b, d, t.lead);
		b.put(this.indent(d));
		const from = b.pos;
		const seq = this.seq++;
		b.put(`task ${t.local} `);
		const nfrom = b.pos;
		const esc = t.quote === '"' ? /(["\\])/g : /(['\\])/g;
		b.put(t.quote + t.name.replace(esc, '\\$1') + t.quote);
		const nameAt = this.rg(b, nfrom, b.pos);
		if (t.nameMacro) {
			const i = t.name.indexOf('${');
			this.macroRanges.push(this.rg(b, nfrom + 1 + i, nfrom + 1 + t.name.indexOf('}', i) + 1));
		}
		const kids = t.kids.filter((k) => k.file === t.file);
		const decl: StmtF[] = [];
		const words = new Set<string>();
		let body: MBody | null = null;
		const hasBody = t.stmts.length + t.calls.length + kids.length > 0;
		if (!hasBody) b.put(this.trail(t.trailing) + eol);
		else if (t.oneLine) {
			b.put(' {');
			body = { file: b.path, open: b.pos, close: 0, elems: [] };
			t.stmts.forEach((s) => {
				b.put(' ');
				const f = this.stmtInline(b, d, s, t, body, 'decl');
				body?.elems.push({
					kind: 'stmt',
					key: s.key,
					from: f.range.from,
					to: f.range.to,
					start: f.range.from,
					scoped: s.scenario !== null,
				});
				decl.push(f);
			});
			b.put(' ');
			body.close = b.pos;
			b.put('}' + this.trail(t.trailing) + eol);
		} else {
			b.put(' {');
			body = { file: b.path, open: b.pos, close: 0, elems: [] };
			b.put(this.trail(t.trailing) + eol);
			t.stmts.forEach((s, i) => {
				this.calls(b, d + 1, t, i, body as MBody, words);
				decl.push(this.stmt(b, d + 1, s, t, body, 'decl'));
			});
			this.calls(b, d + 1, t, t.stmts.length, body, words);
			kids.forEach((k, i) => {
				this.task(k, d + 1, i === 0 && t.stmts.length === 0);
				const kt = this.tasks[this.tasks.length - 1] as TaskF;
				(body as MBody).elems.push({
					kind: 'block',
					key: null,
					from: kt.block.from,
					to: kt.block.to,
					start: kt.start,
				});
			});
			b.put(this.indent(d));
			body.close = b.pos;
			b.put('}' + eol);
		}
		const end = body ? body.close + 1 : nameAt.to;
		const block = this.rg(b, from, end);
		const rec: TaskF = {
			id: t.id,
			parent: t.parent?.id ?? null,
			children: t.kids.map((k) => k.id),
			name: t.nameMacro ? null : t.name,
			nameAt,
			nameMacro: t.nameMacro,
			seq,
			block,
			start: lead ?? from,
			body,
			stmts: decl,
			macroWords: words,
		};
		this.tasks.push(rec);
		if (d === 0) b.tops.push({ kind: 'block', key: 'task', from, to: end, start: lead ?? from });
	}

	calls(b: Buf, d: number, t: MTask, before: number, body: MBody, words: Set<string>): void {
		for (const c of t.calls.filter((x) => x.before === before)) {
			b.put(this.indent(d));
			const from = b.pos;
			b.put(`\${${c.macro}}`);
			this.macroRanges.push(this.rg(b, from, b.pos));
			body.elems.push({ kind: 'stmt', key: null, from, to: b.pos, start: from });
			b.put(this.eol);
			const m = this.plan.macros.find((x) => x.name === c.macro);
			for (const w of m?.body.match(/[A-Za-z_]\w*/g) ?? []) words.add(w);
		}
	}

	/** Prints a resource and its child resources at depth `d` into the entry file. */
	resource(r: MRes, parentId: string | null, d: number): void {
		const b = this.bufs[0] as Buf;
		const { eol } = this;
		b.put(this.indent(d));
		const from = b.pos;
		const seq = this.seq++;
		b.put(`resource ${r.id} `);
		const nfrom = b.pos;
		b.put(`"${r.name}"`);
		const nameAt = this.rg(b, nfrom, b.pos);
		const stmts: StmtF[] = [];
		let body: MBody | null = null;
		if (r.stmts.length + r.kids.length === 0) b.put(eol);
		else {
			b.put(' {');
			body = { file: b.path, open: b.pos, close: 0, elems: [] };
			b.put(eol);
			for (const s of r.stmts) stmts.push(this.stmt(b, d + 1, s, null, body, 'decl'));
			for (const k of r.kids) {
				this.resource(k, r.id, d + 1);
				const kt = this.resTree[this.resTree.length - 1] as TaskF;
				body.elems.push({
					kind: 'block',
					key: null,
					from: kt.block.from,
					to: kt.block.to,
					start: kt.start,
				});
			}
			b.put(this.indent(d));
			body.close = b.pos;
			b.put('}' + eol);
		}
		const end = body ? body.close + 1 : nameAt.to;
		this.resTree.push({
			id: r.id,
			parent: parentId,
			children: r.kids.map((k) => k.id),
			name: r.name,
			nameAt,
			nameMacro: false,
			seq,
			block: this.rg(b, from, end),
			start: from,
			body,
			stmts,
			macroWords: new Set(),
		});
		if (d === 0) b.tops.push({ kind: 'block', key: 'resource', from, to: end, start: from });
	}

	supplements(file: number): void {
		const b = this.bufs[file] as Buf;
		for (const t of preOrder(this.plan.tasks)) {
			// `supplement task` ids read inside a taskprefix include are prefixed (TjpSyntaxRules.rb
			// rule_taskId), so supplements of those tasks go to the entry file.
			const home = this.plan.files[t.file]?.prefix ? 0 : t.file;
			if (home !== file || t.supp.length === 0) continue;
			const from = b.pos;
			b.put(`supplement task ${t.id} {${this.eol}`);
			const rec = this.tasks.find((x) => x.id === t.id) as Mut<TaskF>;
			const added = t.supp.map((s) => this.stmt(b, 1, s, t, null, 'supp'));
			rec.stmts = [...rec.stmts, ...added];
			b.put(`}${this.eol}`);
			b.tops.push({
				kind: 'block',
				key: 'supplement',
				from,
				to: b.pos - this.eol.length,
				start: from,
			});
		}
	}
}
