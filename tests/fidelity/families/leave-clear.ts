// SPDX-License-Identifier: GPL-2.0-or-later
// clearLeave (phase-3.md 6.5, 18.5): takes [start, end) out of every leave item of a scope. An item inside
// goes (with one comma, or its statement), an item over one edge is trimmed (`- end` or `start` rewritten),
// an item spanning the range is split into two items of the same type and name; bounds are written as
// `<start> - <end>`, the end exclusive. The model here reads items in UTC (generated plans, and corpus
// plans without a time zone), so it is drawn only there.
import type { EditIntent } from '../../../src/lib/tjp/edit/types';
import { normLeave, stmtZone, type Facts, type ItemF, type Sem, type StmtF } from '../gen/facts';
import type { Rng } from '../gen/rng';
import type { Drawn, Family, Region } from './types';

type ClearIntent = Extract<EditIntent, { type: 'clearLeave' }>;
type Scope = ClearIntent['scope'];

const DAY = 86400;
const DATE = String.raw`\d{4}-\d\d-\d\d(?:-\d\d:\d\d)?`;
const ITEM = new RegExp(
	String.raw`^(?:(\w+)\s*(?:"([^"]*)")?\s+)?(${DATE})(?:\s*-\s*(${DATE})|\s*\+\s*(\d+)([hdw]))?$`,
);
const UNIT: Readonly<Record<string, number>> = { h: 3600, d: DAY, w: 7 * DAY };

/** One leave item as the model reads it. */
interface Read {
	readonly stmt: StmtF;
	readonly item: ItemF;
	readonly vacation: boolean;
	readonly type: string | null;
	readonly name: string | null;
	readonly start: string;
	/** The end as written when it is a date. */
	readonly end: string | null;
	readonly from: number;
	readonly to: number;
}

function epoch(text: string): number {
	const [d, t] = [text.slice(0, 10), text.slice(11)];
	const [h, m] = t ? t.split(':').map(Number) : [0, 0];
	return Date.parse(`${d}T00:00:00Z`) / 1000 + (h ?? 0) * 3600 + (m ?? 0) * 60;
}

function dateText(e: number): string {
	const iso = new Date(e * 1000).toISOString();
	const time = iso.slice(11, 16);
	return time === '00:00' ? iso.slice(0, 10) : `${iso.slice(0, 10)}-${time}`;
}

function readItem(stmt: StmtF, item: ItemF): Read | null {
	const vacation = stmt.key === 'vacation';
	const m = ITEM.exec(item.written.trim());
	if (!m || (vacation ? m[1] !== undefined : m[1] === undefined)) return null;
	const start = m[3] as string;
	const from = epoch(start);
	const to = m[4]
		? epoch(m[4])
		: m[5]
			? from + Number(m[5]) * (UNIT[m[6] ?? 'd'] ?? DAY)
			: from + DAY;
	return {
		stmt,
		item,
		vacation,
		type: m[1] ?? null,
		name: m[2] ?? null,
		start,
		end: m[4] ?? null,
		from,
		to,
	};
}

const stmtsOf = (f: Facts, scope: Scope): readonly StmtF[] =>
	(scope.kind === 'resource'
		? (f.resById.get(scope.resource)?.stmts ?? []).filter((s) => s.scenario === null)
		: f.globalLeaves
	).filter((s) => s.key === 'leaves' || s.key === 'vacation');

/** The scope's items, read; null when one is not in a form the model knows. */
function itemsOf(f: Facts, scope: Scope): Read[] | null {
	const out: Read[] = [];
	for (const s of stmtsOf(f, scope)) {
		if (s.macro) return null;
		for (const i of s.items ?? []) {
			const r = readItem(s, i);
			if (!r) return null;
			out.push(r);
		}
	}
	return out;
}

/** Whether dates in this plan can be read in UTC: a generated plan, or a corpus plan with no zone. */
const utc = (f: Facts): boolean =>
	f.frameDates ||
	!(f.project?.stmts ?? []).some((s) => s.key === 'timezone' && !/^"(UTC|Etc\/UTC)"$/.test(s.text));

function draw(f: Facts, rng: Rng): Drawn | null {
	if (!utc(f)) return null;
	const scopes: Scope[] = [
		{ kind: 'global' },
		...f.resTree.map((r) => ({ kind: 'resource' as const, resource: r.id })),
	];
	const withItems = scopes.filter((s) => (itemsOf(f, s)?.length ?? 0) > 0);
	if (withItems.length === 0) return null;
	const scope = rng.pick(withItems);
	const items = itemsOf(f, scope) ?? [];
	const it = rng.pick(items);
	const days = Math.max(1, Math.round((it.to - it.from) / DAY));
	const day0 = Math.floor(it.from / DAY) * DAY;
	const mode = rng.pick(['cover', 'head', 'tail', 'split', 'miss'] as const);
	let [a, b] = [day0, day0 + days * DAY];
	if (mode === 'head')
		[a, b] = [day0 + DAY * rng.int(1, days), day0 + DAY * (days + rng.int(0, 3))];
	else if (mode === 'tail') [a, b] = [day0 - DAY * rng.int(0, 3), day0 + DAY * rng.int(1, days)];
	else if (mode === 'split' && days >= 3) [a, b] = [day0 + DAY, day0 + DAY * rng.int(2, days - 1)];
	else if (mode === 'miss') [a, b] = [day0 - DAY * 4, day0 - DAY * 2];
	if (b <= a) b = a + DAY;
	const intent: ClearIntent = { type: 'clearLeave', scope, start: dateText(a), end: dateText(b) };
	return { intent };
}

/** The written texts of an item after the range [cs, ce) is taken out of it. */
function afterClear(r: Read, cs: number, ce: number, csText: string, ceText: string): string[] {
	if (!(r.to > cs && r.from < ce)) return [r.item.written];
	const head = r.from < cs;
	const tail = ce < r.to;
	const prefix = r.type === null ? '' : `${r.type}${r.name === null ? '' : ` "${r.name}"`} `;
	const end = r.end ?? dateText(r.to);
	const out: string[] = [];
	if (head) out.push(`${prefix}${r.start} - ${csText}`);
	if (tail) out.push(`${prefix}${ceText} - ${end}`);
	return out;
}

export const leaveClearFamily: Family = {
	name: 'leave-clear',
	types: ['clearLeave'],
	draw: (_type, f, _sem, rng, aim) => (aim ? null : draw(f, rng)),
	region(intent, f): Region {
		if (intent.type !== 'clearLeave') return [];
		const cs = epoch(intent.start);
		const ce = epoch(intent.end);
		const hit = (itemsOf(f, intent.scope) ?? []).filter((r) => r.to > cs && r.from < ce);
		return [...new Set(hit.map((r) => r.stmt))].flatMap((s) => stmtZone(f, s));
	},
	expect(sem, f, intent): Sem {
		const out = structuredClone(sem);
		if (intent.type !== 'clearLeave') return out;
		const items = itemsOf(f, intent.scope);
		const list =
			intent.scope.kind === 'resource'
				? out.resources.find((r) => r.id === (intent.scope as { resource: string }).resource)
						?.leaves
				: out.leaves;
		if (!items || !list) return out;
		const cs = epoch(intent.start);
		const ce = epoch(intent.end);
		// The Sem lists every own leave statement of the scope, scenario-prefixed ones too: those are
		// kept, so the new list is rebuilt in reading order from the unprefixed items and the rest.
		const all = (
			intent.scope.kind === 'resource'
				? (f.resById.get(intent.scope.resource)?.stmts ?? [])
				: f.globalLeaves
		).filter((s) => (s.key === 'leaves' || s.key === 'vacation') && !s.macro);
		const next: string[] = [];
		for (const s of all) {
			for (const i of s.items ?? []) {
				const r = items.find((x) => x.item === i);
				if (!r) next.push(normLeave(i.written));
				else
					for (const t of afterClear(r, cs, ce, intent.start, intent.end)) next.push(normLeave(t));
			}
		}
		list.splice(0, list.length, ...next);
		return out;
	},
};
