// SPDX-License-Identifier: GPL-2.0-or-later
// Statements both sides type into one block of a kind review round 4 found unchecked (types.ts
// G1, G2): a declaration with no body in the base, given one in either layout (B1); a `shift` or
// `account` body (B2); the file's top level (B3); a task and its supplement in one file (B4).
// Each case says what the merge must do (`expect`), and, like typed-testing.ts, carries `orders`
// (both sides' statements together, in either order) for the engine property.
import { mixSeed, Rng } from '../../../../tests/fidelity/gen/rng';
import type { EditIntent } from '../edit/types';
import { parseTjp } from '../document';
import { statementsIn } from '../tree';
import { planOf } from './sides-testing';
import type { TypedSides } from './typed-testing';

type Files = Record<string, string>;

export interface BlockSides extends TypedSides {
	/** What the merge must give; 'either' where the layout alone may cost a conflict. */
	readonly expect: 'clean' | 'conflict' | 'either';
}

const at = (text: string, pos: number, s: string): string =>
	`${text.slice(0, pos)}${s}${text.slice(pos)}`;

/** Line starts of the top-level statements of `text` (where a statement may be typed), and its end. */
function topLines(text: string): number[] {
	const out: number[] = [];
	for (const st of statementsIn(parseTjp(text).topNode)) {
		const ls = text.lastIndexOf('\n', st.from - 1) + 1;
		if (text.slice(ls, st.from).trim() === '' && !out.includes(ls)) out.push(ls);
	}
	out.push(text.length);
	return out;
}

/** A body's statement lines: where a statement may be typed (after `{`, and after the last line). */
function bodyEnds(text: string, open: number, close: number): number[] {
	const out: number[] = [];
	for (let i = text.indexOf('\n', open); i >= 0 && i < close; i = text.indexOf('\n', i + 1))
		out.push(i + 1);
	return out;
}

/** Both sides type into one block of a round-4 kind; null when the plan offers none. */
export function blockSides(seed: number): BlockSides | null {
	const p = planOf(seed);
	const rng = new Rng(mixSeed(seed, 0xb10c));
	const file = p.entry;
	const text0 = p.files[file] ?? '';
	const nl = text0.includes('\r\n') ? '\r\n' : '\n';
	const f = p.c.facts;
	const start = /project\s+\S+\s+"[^"]*"\s+(\d{4}-\d{2}-\d{2})/.exec(text0)?.[1] ?? '2026-01-05';
	const day = (): string => (rng.chance(0.6) ? 'mon' : 'tue');
	const hours = (): string => (rng.chance(0.5) ? '9:00 - 12:00' : '13:00 - 17:00');
	const kind = rng.int(0, 3);
	let base = text0;
	let ours = '';
	let theirs = '';
	let a = '';
	let b = '';
	let expect: BlockSides['expect'] = 'clean';
	let layout = '';
	let orders: [string, string] = ['', ''];
	const kw = (s: string): string => s.split(' ')[0] ?? '';
	if (kind === 0) {
		// B1: a resource (or the project) without a body, given one by both sides.
		const bare = f.resTree.filter((r) => !r.body && r.block.file === file);
		let end: number;
		if (bare.length > 0)
			end = (bare[rng.int(0, bare.length - 1)] as (typeof bare)[number]).block.to;
		else {
			base = `${text0}resource zz "ZZ"${nl}`;
			end = base.length - nl.length;
		}
		a = `workinghours ${day()} ${hours()}`;
		b = `workinghours ${day()} ${hours()}`;
		const one = (s: string): string => ` { ${s} }`;
		const lines = (s: string): string => ` {${nl}  ${s}${nl}}`;
		const [la, lb] = [rng.chance(0.5), rng.chance(0.5)];
		ours = at(base, end, la ? one(a) : lines(a));
		theirs = at(base, end, lb ? one(b) : lines(b));
		layout = `no body in the base, ${la ? 'one line' : 'lines'} / ${lb ? 'one line' : 'lines'}`;
		const sameDay = a.split(' ')[1] === b.split(' ')[1];
		expect = la !== lb ? 'either' : a === b ? 'clean' : sameDay ? 'conflict' : 'clean';
		orders = [at(base, end, lines(`${a}${nl}  ${b}`)), at(base, end, lines(`${b}${nl}  ${a}`))];
	} else if (kind === 1) {
		// B2: a shift (assigned to a resource) or an account body.
		const shift = rng.chance(0.6);
		const decl = shift
			? `shift s9 "S9" {${nl}  workinghours sat, sun off${nl}  timezone "UTC"${nl}}${nl}`
			: `account acc9 "Acc9" {${nl}  credits ${start} "base" 1.0${nl}  credits ${start} "more" 1.0${nl}}${nl}`;
		const tops = topLines(text0);
		const where = tops.length > 1 ? (tops[1] as number) : text0.length;
		base = at(text0, where, decl);
		if (shift) {
			const res = f.resTree.filter(
				(r) => r.body && r.body.file === file && r.children.length === 0,
			);
			const r = res[rng.int(0, Math.max(0, res.length - 1))];
			const close = r?.body ? r.body.close + decl.length * (r.body.close >= where ? 1 : 0) : -1;
			if (close >= 0) base = at(base, close, `  shifts s9 ${start} +2m${nl}`);
		}
		const open = base.indexOf('{', where) + 1;
		const close = base.indexOf(`${nl}}`, open) + nl.length;
		const lines = bodyEnds(base, open, close);
		a = shift ? `workinghours mon - fri 9:00 - 12:00` : `credits ${start} "ours" 2.0`;
		b = shift
			? `workinghours ${rng.chance(0.5) ? 'mon - fri' : 'tue'} 13:00 - 17:00`
			: `credits ${start} "theirs" 3.0`;
		const pa = lines[0] as number;
		const pb = lines[lines.length - 1] as number;
		ours = at(base, pa, `  ${a}${nl}`);
		theirs = at(base, pb, `  ${b}${nl}`);
		layout = shift ? 'shift body' : 'account body';
		expect = 'conflict';
		orders = [at(base, pb, `  ${a}${nl}  ${b}${nl}`), at(base, pb, `  ${b}${nl}  ${a}${nl}`)];
	} else if (kind === 2) {
		// B3: the top level: macros and a single-valued statement.
		const tops = topLines(text0);
		const pick = (): number => tops[rng.int(1, tops.length - 1)] ?? text0.length;
		const choice = rng.int(0, 2);
		a = choice === 2 ? 'copyright "Ours"' : 'macro m9 [ 1 ]';
		b = choice === 2 ? 'copyright "Theirs"' : choice === 1 ? 'macro n9 [ 2 ]' : 'macro m9 [ 2 ]';
		const [pa, pb] = [pick(), pick()];
		ours = at(text0, pa, `${a}${nl}`);
		theirs = at(text0, pb, `${b}${nl}`);
		layout = 'top level';
		expect = choice === 1 ? (pa === pb ? 'either' : 'clean') : 'conflict';
		orders = [`${text0}${a}${nl}${b}${nl}`, `${text0}${b}${nl}${a}${nl}`];
	} else {
		// B4: a task and its supplement in one file.
		const tasks = f.tasks.filter(
			(t) =>
				t.body &&
				t.body.file === file &&
				!t.nameMacro &&
				/^[\w.]+$/.test(t.id) &&
				!t.stmts.some((s) => ['priority', 'complete'].includes(s.key)),
		);
		const t = tasks[rng.int(0, tasks.length - 1)];
		if (!t?.body) return null;
		base = `${text0}supplement task ${t.id} {${nl}  note "supplement"${nl}}${nl}`;
		const value = (): string =>
			rng.chance(0.5) ? `priority ${rng.int(1, 999)}` : `complete ${rng.int(0, 100)}`;
		[a, b] = [value(), value()];
		const close = t.body.close;
		const lineStart = base.lastIndexOf('\n', close - 1) + 1;
		if (base.slice(lineStart, close).trim() !== '') return null;
		const inDecl = (s: string): string => at(base, lineStart, `  ${s}${nl}`);
		const sOpen = base.indexOf('{', text0.length) + 1;
		const inSupp = (s: string): string => at(base, base.indexOf('\n', sOpen) + 1, `  ${s}${nl}`);
		const flip = rng.chance(0.5);
		ours = flip ? inSupp(a) : inDecl(a);
		theirs = flip ? inDecl(b) : inSupp(b);
		layout = 'declaration and supplement';
		expect = kw(a) === kw(b) ? 'conflict' : 'clean';
		orders = [inDecl(`${a}${nl}  ${b}`), inDecl(`${b}${nl}  ${a}`)];
	}
	if (ours === theirs) return null;
	const intent: EditIntent = { type: 'setAttr', task: '', attr: 'note', value: `${a} / ${b}` };
	const files = (t: string): Files => ({ ...p.files, [file]: t });
	return {
		p: { ...p, files: files(base) },
		a: { intent, files: files(ours), changes: null },
		b: { intent, files: files(theirs), changes: null },
		what: `${layout}: ${a} / ${b}`,
		typed: [[a], [b]],
		layout,
		expect,
		orders: [files(orders[0]), files(orders[1])],
	};
}
