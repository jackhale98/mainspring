// SPDX-License-Identifier: GPL-2.0-or-later
// The statements of the random plan model: sizing, dependencies, allocations, other attributes,
// scenario-prefixed statements, supplements and macros. Valid by construction (see model.ts).
import { COMMENTS, list, mk, type MPlan, type MRes, type MStmt, type MTask } from './model-types';
import type { Rng } from './rng';

const hours = (rng: Rng): string => (rng.chance(0.3) ? `${rng.int(1, 2)}d` : `${rng.int(2, 16)}h`);
const date = (rng: Rng, lo: number, hi: number): string => {
	const d = new Date(Date.UTC(2026, 0, 5 + rng.int(lo, hi)));
	return d.toISOString().slice(0, 10);
};
const ancestors = (t: MTask): MTask[] => (t.parent ? [t.parent, ...ancestors(t.parent)] : []);

export function statements(
	rng: Rng,
	all: MTask[],
	res: string[],
	flags: string[],
	scenarios: boolean,
): void {
	const order = new Map(all.map((t, i) => [t, i]));
	for (const t of all) {
		const leaf = t.kids.length === 0;
		const s = t.stmts;
		const hasStart = leaf && rng.chance(0.12);
		let deps: string[] = [];
		const anc = new Set(ancestors(t));
		const prior = all.filter(
			(x) => (order.get(x) as number) < (order.get(t) as number) && !anc.has(x),
		);
		if (leaf && !hasStart && rng.chance(0.4)) {
			deps = rng.sample(prior, rng.int(1, 2)).map((x) => x.id);
		}
		const kind = !leaf
			? 'container'
			: hasStart || deps.length > 0
				? rng.chance(0.2)
					? 'milestone'
					: pickSizing(rng)
				: pickSizing(rng);
		if (kind === 'effort') s.push(mk('effort', hours(rng)));
		else if (kind === 'duration' || kind === 'length') s.push(mk(kind, hours(rng)));
		else if (kind === 'milestone') s.push(mk('milestone', null));
		if (kind === 'milestone' && !hasStart && deps.length === 0) {
			s.push(mk('start', date(rng, 7, 40)));
		}
		if (hasStart) s.push(mk('start', date(rng, 0, 50)));
		// A fixed end makes an effort task ALAP (15.20); it needs no start and no dependency.
		if (leaf && kind === 'effort' && !hasStart && deps.length === 0 && rng.chance(0.08)) {
			s.push(mk('end', date(rng, 30, 70)));
		}
		if (deps.length > 0) {
			s.push(list('depends', deps, { wrap: deps.length > 1 && rng.chance(0.3) }));
			for (const i of s[s.length - 1]?.items ?? []) {
				i.rel = rng.chance(0.4);
				i.gap = rng.chance(0.15)
					? { kind: rng.pick(['gapduration', 'gaplength'] as const), value: `${rng.int(1, 6)}h` }
					: null;
			}
		}
		const hasOwnAlloc =
			kind === 'effort' && !ancestors(t).some((a) => a.stmts.some((x) => x.key === 'allocate'));
		if (
			hasOwnAlloc ||
			(kind === 'container' && rng.chance(0.25)) ||
			(leaf && kind !== 'milestone' && rng.chance(0.15))
		) {
			const want = rng.sample(res, rng.int(1, Math.min(2, res.length)));
			s.push(list('allocate', want, { wrap: want.length > 1 && rng.chance(0.3) }));
		}
		if (rng.chance(0.2)) s.push(mk('priority', String(rng.int(1, 999))));
		if (rng.chance(0.15))
			s.push(mk('note', `"${rng.pick(['rough', 'check scope', 'ask the owner', 'later'])}"`));
		if (flags.length > 0 && rng.chance(0.18))
			s.push(list('flags', rng.sample(flags, rng.int(1, 2))));
		if (rng.chance(0.08)) s.push(list('responsible', rng.sample(res, 1)));
		if (kind === 'effort' && rng.chance(0.06)) s.push(mk('complete', String(rng.int(5, 90))));
		if (leaf && rng.chance(0.05)) s.push(mk('minstart', date(rng, 0, 30)));
		if (leaf && rng.chance(0.04)) s.push(mk('scheduling', 'asap'));
		// Another scenario's dependency: not on one the task has, and on a task that is otherwise free.
		const fixed = s.some((x) => ['start', 'end'].includes(x.key));
		const have = new Set(
			s.filter((x) => x.key === 'depends').flatMap((x) => x.items?.map((i) => i.target) ?? []),
		);
		const fresh = prior.filter((x) => !have.has(x.id));
		if (
			scenarios &&
			leaf &&
			kind !== 'milestone' &&
			!fixed &&
			fresh.length > 0 &&
			rng.chance(0.15)
		) {
			s.push(list('depends', [rng.pick(fresh).id], { scenario: 'late' }));
		}
		const own = s.find((x) => x.key === 'allocate' && x.scenario === null);
		if (scenarios && own && rng.chance(0.2)) {
			const spare = res.filter((r) => !own.items?.some((i) => i.target === r));
			if (spare.length > 0) s.push(list('allocate', [rng.pick(spare)], { scenario: 'late' }));
		}
		if (scenarios && rng.chance(0.3)) {
			s.push(mk('priority', String(rng.int(1, 999)), { scenario: 'late' }));
			if (kind === 'effort') s.push(mk('effort', hours(rng), { scenario: 'late' }));
		}
		if (rng.chance(0.2)) {
			for (const x of s)
				if (x.key !== 'effort' || x.scenario === null)
					x.trailing = rng.chance(0.4) ? rng.pick(COMMENTS) : null;
		}
		for (const x of s)
			if (rng.chance(0.1)) x.lead = { text: rng.pick(COMMENTS), attached: rng.chance(0.7) };
		if (rng.chance(0.3)) shuffleSome(rng, s);
		// A top-scenario criterion read after another scenario's resets that scenario's (15.20),
		// so scenario statements always come last.
		s.splice(
			0,
			s.length,
			...s.filter((x) => x.scenario === null),
			...s.filter((x) => x.scenario !== null),
		);
		t.oneLine = leaf && s.length <= 3 && s.every((x) => !x.lead && !x.wrap) && rng.chance(0.25);
	}
}

const pickSizing = (rng: Rng): string =>
	rng.pick(['effort', 'effort', 'effort', 'duration', 'length']);

/** Moves a few statements to other places, so the order is not always canonical. */
function shuffleSome(rng: Rng, s: MStmt[]): void {
	for (let k = 0; k < 2 && s.length > 1; k++) {
		const i = rng.int(0, s.length - 1);
		const [x] = s.splice(i, 1);
		if (x) s.splice(rng.int(0, s.length), 0, x);
	}
}

export function supplements(rng: Rng, all: MTask[], res: string[], flags: string[]): void {
	// One task has the same attribute in its declaration and in a supplement, so that removing it has
	// several sites to remove (the last site wins for a rewrite).
	if (rng.chance(0.7)) {
		const t = rng.pick(all);
		if (!t.stmts.some((x) => x.key === 'note' && x.scenario === null))
			t.stmts.push(mk('note', '"base note"'));
		t.supp.push(mk('note', '"added in a supplement"'));
	}
	for (const t of rng.sample(all, rng.int(1, 3))) {
		const hasStart = t.stmts.some((x) => x.key === 'start' && x.scenario === null);
		const leaf = t.kids.length === 0;
		const pool = ['note', 'priority', 'complete', 'flags', 'responsible', 'allocate', 'depends'];
		for (const key of rng.sample(pool, rng.int(1, 2))) {
			// Most attributes appear once; some are written again in a supplement (the last site wins).
			const dup =
				['note', 'priority', 'flags', 'responsible', 'complete'].includes(key) && rng.chance(0.6);
			if (t.stmts.some((x) => x.key === key && x.scenario === null) && !dup) continue;
			if (key === 'note') t.supp.push(mk('note', '"added in a supplement"'));
			else if (key === 'priority') t.supp.push(mk('priority', String(rng.int(1, 999))));
			else if (key === 'complete' && leaf && t.stmts.some((x) => x.key === 'effort'))
				t.supp.push(mk('complete', '30'));
			else if (key === 'flags' && flags.length > 0) t.supp.push(list('flags', [rng.pick(flags)]));
			else if (key === 'responsible') t.supp.push(list('responsible', [rng.pick(res)]));
			else if (key === 'allocate' && leaf) t.supp.push(list('allocate', [rng.pick(res)]));
			else if (
				key === 'depends' &&
				leaf &&
				!hasStart &&
				!t.stmts.some((x) => ['start', 'end', 'precedes', 'depends'].includes(x.key))
			) {
				const i = all.indexOf(t);
				const anc = new Set(ancestors(t));
				const prior = all.slice(0, i).filter((x) => !anc.has(x));
				const p = prior.length > 0 ? rng.pick(prior) : null;
				if (p) t.supp.push(list('depends', [p.id]));
			}
		}
	}
}

export function macros(rng: Rng, plan: MPlan, all: MTask[]): void {
	const effortLeaves = all.filter(
		(t) => t.kids.length === 0 && t.stmts.some((x) => x.key === 'effort' && x.scenario === null),
	);
	plan.macros.push({ name: 'LEN', body: ' 3d ', multiline: false });
	const user = rng.pick(effortLeaves.length > 0 ? effortLeaves : all);
	const eff = user.stmts.find((x) => x.key === 'effort' && x.scenario === null);
	if (eff) {
		eff.value = '${LEN}';
		eff.macro = true;
	}
	const unprio = all.filter((t) => !t.stmts.some((x) => x.key === 'priority'));
	if (unprio.length > 0 && rng.chance(0.8)) {
		plan.macros.push({ name: 'PRIO', body: ' priority 600 ', multiline: rng.chance(0.4) });
		const t = rng.pick(unprio);
		t.calls.push({ macro: 'PRIO', before: rng.int(0, t.stmts.length) });
		t.oneLine = false;
	}
	// A dependency list written with a macro: the statement is text-only, and the engine still reads it.
	const withDeps = all.filter((t) =>
		t.stmts.some((x) => x.key === 'depends' && x.scenario === null && x.items),
	);
	if (withDeps.length > 0 && rng.chance(0.6)) {
		const t = rng.pick(withDeps);
		const st = t.stmts.find((x) => x.key === 'depends' && x.scenario === null && x.items) as MStmt;
		plan.macros.push({
			name: 'DEPT',
			body: ` ${(st.items ?? []).map((i) => i.target).join(', ')} `,
			multiline: false,
		});
		st.value = '${DEPT}';
		st.items = null;
		st.macro = true;
		st.wrap = false;
		t.oneLine = false;
	}
	// An allocation written by a statement-level macro call: allocation intents on the task are refused.
	const withAlloc = effortLeaves.filter(
		(t) =>
			t.stmts.some((x) => x.key === 'allocate' && x.scenario === null && !x.macro) &&
			!t.calls.length,
	);
	if (withAlloc.length > 0 && rng.chance(0.6)) {
		const t = rng.pick(withAlloc);
		const i = t.stmts.findIndex((x) => x.key === 'allocate' && x.scenario === null);
		const st = t.stmts[i] as MStmt;
		plan.macros.push({
			name: 'ALLOC',
			body: ` allocate ${(st.items ?? []).map((x) => x.target).join(', ')} `,
			multiline: false,
		});
		t.stmts.splice(i, 1);
		t.calls.push({ macro: 'ALLOC', before: Math.min(i, t.stmts.length) });
		t.oneLine = false;
	}
	if (rng.chance(0.6)) {
		plan.macros.push({ name: 'SUF', body: ' phase ', multiline: false });
		const t = rng.pick(all);
		t.name = 'Build ${SUF}';
		t.nameMacro = true;
		t.quote = '"';
	}
}

const LEAVE_ITEMS = [
	'annual 2026-03-02 - 2026-03-06',
	'sick 2026-02-10',
	'special "Retreat" 2026-03-10 - 2026-03-11',
	'annual 2026-02-23 +2d',
];
const GLOBAL_LEAVES = [
	'holiday "Founders Day" 2026-02-16',
	'holiday "Spring Break" 2026-03-30 - 2026-03-31',
];

const leaf = (key: string, items: string[]): MStmt =>
	mk(key, null, { items: items.map((target) => ({ target, rel: false, gap: null })) });

/** Resource attributes, file-level leaves and the project header statements (T11d intents edit them). */
export function resourceStatements(rng: Rng, plan: MPlan): void {
	const all = flat(plan.resources);
	all.forEach((r, i) => {
		if (r.kids.length > 0) return;
		const s = r.stmts;
		if (rng.chance(0.4)) s.push(mk('email', `"${r.id}@example.org"`));
		const earlier = all.slice(0, i).filter((x) => x.kids.length === 0 && !isUnder(r, x));
		if (earlier.length > 0 && rng.chance(0.2)) s.push(list('managers', [rng.pick(earlier).id]));
		if (rng.chance(0.25)) s.push(mk('efficiency', rng.pick(['1', '0.9', '1.1'])));
		if (rng.chance(0.2)) s.push(mk('rate', rng.pick(['100', '85.5'])));
		if (rng.chance(0.15)) s.push(mk('workinghours', 'fri 9:00 - 15:00'));
		if (rng.chance(0.25)) s.push(leaf('leaves', rng.sample(LEAVE_ITEMS, rng.int(1, 2))));
		if (rng.chance(0.2)) s.sort((a, b) => (a.key < b.key ? -1 : 1));
		if (rng.chance(0.2) && s.length > 1) s.reverse();
	});
	if (rng.chance(0.35))
		plan.globalLeaves.push(leaf('leaves', rng.sample(GLOBAL_LEAVES, rng.int(1, 2))));
	const p = plan.projectStmts;
	p.push(mk('now', '2026-01-05-09:00'));
	if (rng.chance(0.3)) p.push(mk('timezone', '"UTC"'));
	if (rng.chance(0.25)) p.push(mk('timeformat', '"%Y-%m-%d"'));
	if (rng.chance(0.25)) p.push(mk('currency', '"EUR"'));
	if (rng.chance(0.2)) p.push(mk('dailyworkinghours', '8'));
	if (rng.chance(0.15)) p.push(mk('workinghours', 'sat off'));
	if (rng.chance(0.15)) p.push(mk('weekstartsmonday', null));
	if (rng.chance(0.2)) p.reverse();
}

const flat = (rs: readonly MRes[]): MRes[] => rs.flatMap((r) => [r, ...flat(r.kids)]);
const isUnder = (a: MRes, b: MRes): boolean => flat(a.kids).includes(b);

/**
 * `precedes`: an effort task ends before a task with a fixed start well into the project. It makes the
 * task ALAP, so it needs no start, end or dependency of its own, and the later task must not start at once.
 */
export function precedes(rng: Rng, all: MTask[]): void {
	const startOf = (t: MTask): number | null => {
		const v = t.stmts.find((x) => x.key === 'start' && x.scenario === null)?.value;
		return v ? Date.parse(`${v.slice(0, 10)}T00:00:00Z`) : null;
	};
	const first = Date.UTC(2026, 0, 5);
	for (const t of all) {
		const free =
			t.kids.length === 0 && t.stmts.some((x) => x.key === 'effort' && x.scenario === null);
		const busy = t.stmts.some((x) =>
			['start', 'end', 'depends', 'scheduling', 'precedes'].includes(x.key),
		);
		if (!free || busy || t.stmts.some((x) => x.macro) || !rng.chance(0.12)) continue;
		const i = all.indexOf(t);
		const late = all.slice(i + 1).filter((x) => {
			const d = startOf(x);
			return (
				d !== null &&
				d - first >= 14 * 86400000 &&
				!x.stmts.some((y) => y.key === 'depends' && y.items?.some((it) => it.target === t.id))
			);
		});
		const x = late.length > 0 ? rng.pick(late) : null;
		if (x) t.stmts.push(list('precedes', [x.id]));
	}
}
