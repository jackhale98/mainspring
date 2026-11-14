// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Cases for the fast-path suites (phase-2.md section 12, T19; ADR-0010): in-place value
 * rewrites of a workspace, each with the `FastEdit` the runner would send and the edited text the
 * full run gets.
 *
 * Which statements may be rewritten, and the edits of a change, come from the app's own module
 * (src/lib/workspace/fast-patch.ts), as the runner will use them. The edit API (`setAttr`)
 * writes the new value. The bridge checks everything again against its own parse
 * (engine/bridge/fast_path.rb) and runs in full when it cannot vouch for a patch, so a case may
 * fall back; the result must match anyway.
 *
 * Values: a different duration, a date moved by up to ten days, a priority or a completion,
 * and now and then one out of range (complete 150, priority 2000) that TaskJuggler refuses while
 * parsing, which must fall back.
 */
import type { FastAttr, FastEdit, ScheduleResult } from '../../src/engine/protocol';
import { applyIntent } from '../../src/lib/tjp/edit/apply';
import type { TaskAttr } from '../../src/lib/tjp/edit/types';
import { buildIndex, type EngineHints, type SymbolIndex } from '../../src/lib/tjp/index';
import { FAST_ATTRS, fastEditsOf, fastSites, type FastSite } from '../../src/lib/workspace/fast-patch';
import type { Workspace } from '../../src/lib/workspace/workspace';
import { Rng } from '../fidelity/gen/rng';

export type Site = FastSite;

export interface Rewrite {
	readonly site: Site;
	readonly edit: FastEdit;
	/** The full workspace text after the rewrite. */
	readonly files: Record<string, string>;
}

/** The sites a fast patch may rewrite (fast-patch.ts). */
export function eligibleSites(ws: Workspace, index: SymbolIndex): Site[] {
	return fastSites(ws.snapshot(), index);
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** A new value for a site: different from the old one, sometimes out of range. */
export function newValue(site: Site, rng: Rng): string {
	switch (site.attribute) {
		case 'effort':
		case 'length':
		case 'duration': {
			const options = ['1d', '2d', '3d', '5d', '8d', '13d', '4h', '1w', '2w'];
			const pick = options.filter((v) => v !== site.value);
			return pick[rng.int(0, pick.length - 1)] ?? '2d';
		}
		case 'start':
		case 'end': {
			const m = /^(\d{4})-(\d{2})-(\d{2})(-\d{2}:\d{2}(?::\d{2})?)?(.*)$/.exec(site.value);
			if (!m) return site.value;
			const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
			const shift = [-10, -3, -1, 1, 2, 5, 10][rng.int(0, 6)] ?? 1;
			d.setUTCDate(d.getUTCDate() + shift);
			const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
			return `${day}${m[4] ?? ''}${m[5] ?? ''}`;
		}
		case 'priority':
			return rng.chance(0.1) ? '2000' : String(rng.int(1, 1000));
		case 'complete':
			return rng.chance(0.1) ? '150' : String(rng.int(0, 20) * 5);
	}
}

/**
 * The rewrite of a site to `value` through the edit API, or null when it is not one in-place
 * rewrite of that site (another statement, a refusal, a no-op).
 */
export function rewrite(ws: Workspace, index: SymbolIndex, site: Site, value: string): Rewrite | null {
	const snap = ws.snapshot();
	const r = applyIntent(snap, index, {
		type: 'setAttr',
		task: site.task.id,
		attr: site.attribute as TaskAttr,
		value,
	});
	if (r.status !== 'edit') return null;
	const edits = fastEditsOf(snap, index, r.edit.changes);
	const edit = edits?.[0];
	if (!edits || edits.length !== 1 || !edit || edit.line !== site.line || edit.file !== site.file) {
		return null;
	}
	const files: Record<string, string> = {};
	for (const [p, f] of snap.files) {
		const cs = r.edit.changes[p];
		files[p] = cs ? cs.apply(f.text).toString() : f.text.toString();
	}
	return { site, edit, files };
}

/** The index of a workspace, with engine hints when ids come from macros. */
export function indexOf(ws: Workspace, hints?: EngineHints): SymbolIndex {
	return buildIndex(ws.snapshot(), hints, { cache: null });
}

/** A result without `revision` and `timings`, as canonical JSON (keys sorted). */
export function canonicalResult(r: ScheduleResult): string {
	const { revision: _r, timings: _t, ...rest } = r;
	return JSON.stringify(sortKeys(rest));
}

function sortKeys(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(sortKeys);
	if (v && typeof v === 'object') {
		return Object.fromEntries(
			Object.keys(v as Record<string, unknown>)
				.sort()
				.map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
		);
	}
	return v;
}

const isoDay = (d: number): string => `2026-${pad(1 + Math.floor((d - 1) / 28))}-${pad(1 + ((d - 1) % 28))}`;

/**
 * A plan of the direction family (the T19 review, H1): scenarios `plan` and its child `late`,
 * and tasks whose `start` or `end` comes with a statement that sets the direction in one
 * scenario or both (`late:depends`, `late:scheduling`, `late:end`, `late:start`, `depends`,
 * `precedes`, `scheduling`), before or after it. A `start` or `end` rewrite there may run fast
 * only when no scenario's direction would change.
 */
export function directionPlan(rng: Rng): Record<string, string> {
	const lines = [
		'project p "P" 2026-01-05 +4m {',
		'  scenario plan "Plan" { scenario late "Late" }',
		'}',
		'resource r1 "R1"',
		'resource r2 "R2"',
		'task m "M" { start 2026-04-20 }',
	];
	const n = rng.int(3, 6);
	for (let i = 0; i < n; i++) {
		const prev = i > 0 ? `t${i - 1}` : null;
		const anchor = rng.chance(0.5) ? `start ${isoDay(rng.int(8, 30))}` : `end ${isoDay(rng.int(40, 70))}`;
		const extras = [
			prev ? `late:depends ${prev}` : null,
			'late:scheduling alap',
			'late:scheduling asap',
			`late:end ${isoDay(rng.int(72, 90))}`,
			`late:start ${isoDay(rng.int(8, 20))}`,
			prev ? `depends ${prev}` : null,
			'precedes m',
			'late:precedes m',
			'scheduling alap',
			'scheduling asap',
		].filter((x): x is string => x !== null);
		const body = [anchor, `effort ${rng.int(1, 6)}d`, `allocate r${rng.int(1, 2)}`];
		for (const extra of rng.sample(extras, rng.int(0, 2))) {
			if (rng.chance(0.5)) body.push(extra);
			else body.unshift(extra);
		}
		lines.push(`task t${i} "T${i}" {`, ...body.map((b) => `  ${b}`), '}');
	}
	return { 'plan.tjp': `${lines.join('\n')}\n` };
}

/**
 * Rewrites of every top-scenario `start` and `end` line of a one-file plan whose tasks are
 * top-level blocks, sent whether or not fast-patch.ts would offer them: what a wrong main thread
 * could send, so the bridge's own checks alone decide (ADR-0010, "What the bridge checks").
 */
export function rawDateRewrites(ws: Workspace, index: SymbolIndex, rng: Rng): Rewrite[] {
	const out: Rewrite[] = [];
	const entry = ws.snapshot().entry;
	const text = ws.snapshot().files.get(entry)?.text.toString() ?? '';
	const lines = text.split('\n');
	let task: string | null = null;
	lines.forEach((l, i) => {
		const open = /^task (\w+) /.exec(l);
		if (open) task = open[1] ?? null;
		const m = /^[ \t]+(start|end)[ \t]+(\S+)$/.exec(l);
		const symbol = task ? index.tasks.get(task) : undefined;
		if (!m || !symbol) return;
		const attribute = m[1] as 'start' | 'end';
		const site: Site = { task: symbol, attribute, file: entry, line: i + 1, value: m[2] ?? '' };
		const value = newValue(site, rng);
		const next = [...lines];
		next[i] = l.replace(site.value, value);
		out.push({
			site,
			edit: { task: symbol.id, attribute, scenario: null, value, file: entry, line: i + 1 },
			files: { [entry]: next.join('\n') },
		});
	});
	return out;
}

/**
 * A plan of the purge family (the T19 review, round 3, D1): leaf tasks with value statements,
 * each now and then with a `purge <attribute>` (`late:` scoped when the plan has scenarios)
 * before or after them, and supplements that purge or set values again. A purge after a
 * rewritten statement resets it in a full parse; the fast path must run such a rewrite in full.
 */
export function purgePlan(rng: Rng): Record<string, string> {
	const scenarios = rng.chance(0.5);
	const lines = [
		'project p "P" 2026-01-05 +4m {',
		...(scenarios ? ['  scenario plan "Plan" { scenario late "Late" }'] : []),
		'}',
		'resource r1 "R1"',
		'resource r2 "R2"',
	];
	const attrs = ['start', 'end', 'effort', 'length', 'priority', 'complete', 'milestone', 'allocate', 'forward'];
	const purge = (): string => `purge ${scenarios && rng.chance(0.3) ? 'late:' : ''}${rng.pick(attrs)}`;
	const n = rng.int(3, 6);
	const ids: string[] = [];
	for (let i = 0; i < n; i++) {
		const id = `t${i}`;
		const body: string[] = [];
		if (rng.chance(0.7)) body.push(`effort ${rng.int(1, 6)}d`, `allocate r${rng.int(1, 2)}`);
		else body.push(`length ${rng.int(1, 6)}d`);
		if (rng.chance(0.5)) body.push(rng.chance(0.6) ? `start ${isoDay(rng.int(3, 30))}` : `end ${isoDay(rng.int(40, 80))}`);
		if (rng.chance(0.4)) body.push(`priority ${rng.int(1, 999)}`);
		if (rng.chance(0.4)) body.push(`complete ${rng.int(0, 20) * 5}`);
		if (ids.length > 0 && rng.chance(0.3)) body.push(`depends ${rng.pick(ids)}`);
		for (let k = rng.int(0, 2); k > 0; k--) body.splice(rng.int(0, body.length), 0, purge());
		lines.push(`task ${id} "T${i}" {`, ...body.map((b) => `  ${b}`), '}');
		ids.push(id);
	}
	if (rng.chance(0.6)) {
		const supp = [rng.chance(0.5) ? purge() : `priority ${rng.int(1, 999)}`];
		if (rng.chance(0.4)) supp.push(purge());
		lines.push(`supplement task ${rng.pick(ids)} {`, ...supp.map((b) => `  ${b}`), '}');
	}
	return { 'plan.tjp': `${lines.join('\n')}\n` };
}

const LONE = /^([ \t]*)(effort|length|duration|start|end|priority|complete)[ \t]+(\S+)[ \t]*$/;

/**
 * Rewrites of the lone value statements of a workspace's tasks, as the index places them, sent
 * whether or not fast-patch.ts would offer them: what a wrong main thread could send, so the
 * bridge's checks alone decide. At most `limit`, those of tasks with a `purge` first. `texts`
 * are the files as sent (their line ends kept: a CRLF file stays CRLF).
 */
export function rawRewrites(
	ws: Workspace,
	index: SymbolIndex,
	rng: Rng,
	limit: number,
	texts: Readonly<Record<string, string>>,
): Rewrite[] {
	const snap = ws.snapshot();
	const all: { rewrite: Rewrite; purged: boolean }[] = [];
	for (const task of index.tasks.values()) {
		const purged = task.attrs.some((a) => a.keyword === 'purge');
		for (const a of task.attrs) {
			if (a.scenario !== null || !(FAST_ATTRS as readonly string[]).includes(a.keyword)) continue;
			const file = snap.files.get(a.statement.file);
			if (!file) continue;
			const line = file.text.lineAt(a.statement.from);
			const m = LONE.exec(line.text);
			if (!m || m[2] !== a.keyword) continue;
			const site: Site = {
				task,
				attribute: a.keyword as FastAttr,
				file: a.statement.file,
				line: line.number,
				value: m[3] ?? '',
			};
			const value = newValue(site, rng);
			if (value === site.value) continue;
			const lines = (texts[a.statement.file] ?? '').split('\n');
			const cr = lines[line.number - 1]?.endsWith('\r') ? '\r' : '';
			lines[line.number - 1] = `${m[1] ?? ''}${a.keyword} ${value}${cr}`;
			const files: Record<string, string> = { ...texts, [a.statement.file]: lines.join('\n') };
			const edit: FastEdit = {
				task: task.id,
				attribute: site.attribute,
				scenario: null,
				value,
				file: site.file,
				line: site.line,
			};
			all.push({ rewrite: { site, edit, files }, purged });
		}
	}
	const first = all.filter((x) => x.purged);
	const rest = rng.sample(
		all.filter((x) => !x.purged),
		Math.max(0, limit - first.length),
	);
	return [...first.slice(0, limit), ...rest].map((x) => x.rewrite);
}

export { Rng };
