// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Cases for the fast-path spike (phase-2.md section 12, T19): in-place value rewrites of a
 * workspace, each with the `FastPatch` edit the runner would send and the edited text the full
 * run gets.
 *
 * Eligibility (section 12, step 2) is decided here from the symbol index, as the main thread
 * would: a task's own single-line `effort`, `length`, `duration`, `start`, `end`, `priority` or
 * `complete` statement for the top scenario, in a task that is not text-only, not built by a
 * macro and has no macro call in its body; no other site of the same keyword in the task
 * (another scenario, a supplement); `priority` only on a leaf (children copy it when they are
 * created; `start` and `end` they do not). The edit API (`setAttr`) writes the new value, and the change must stay on that
 * one line. The bridge checks again what it can (engine/bridge/fast_path.rb) and runs in full
 * when it cannot vouch for a patch, so a case may also fall back; the result must match anyway.
 *
 * Values: a different duration, a date moved by up to ten days, a priority or a completion,
 * and now and then one out of range (complete 150, priority 2000) that TaskJuggler refuses while
 * parsing, which must fall back.
 */
import type { FastAttr, FastEdit, ScheduleResult } from '../../src/engine/protocol';
import { applyIntent } from '../../src/lib/tjp/edit/apply';
import type { TaskAttr } from '../../src/lib/tjp/edit/types';
import { buildIndex, type EngineHints, type SymbolIndex, type TaskSymbol } from '../../src/lib/tjp/index';
import type { Workspace } from '../../src/lib/workspace/workspace';
import { Rng } from '../fidelity/gen/rng';

export const FAST_ATTRS: readonly FastAttr[] = [
	'effort',
	'length',
	'duration',
	'start',
	'end',
	'priority',
	'complete',
];
const DURATIONS = new Set(['effort', 'length', 'duration', 'milestone']);
/** Keywords children copy from their parent when they are created (Project.rb attribute table). */
const INHERITED = new Set(['priority']);

export interface Site {
	readonly task: TaskSymbol;
	readonly attribute: FastAttr;
	readonly file: string;
	/** 1-based. */
	readonly line: number;
	/** The value as written now. */
	readonly value: string;
}

export interface Rewrite {
	readonly site: Site;
	readonly edit: FastEdit;
	/** The full workspace text after the rewrite. */
	readonly files: Record<string, string>;
}

/** The sites a fast patch may rewrite (module comment). */
export function eligibleSites(ws: Workspace, index: SymbolIndex): Site[] {
	const snap = ws.snapshot();
	const out: Site[] = [];
	for (const task of index.tasks.values()) {
		if (task.textOnly || task.expandedOnly || task.bodyMacroCalls.length > 0) continue;
		for (const a of task.attrs) {
			const attribute = a.keyword as FastAttr;
			if (!FAST_ATTRS.includes(attribute) || a.scenario !== null || !a.value || a.textOnly) continue;
			if (INHERITED.has(attribute) && task.children.length > 0) continue;
			const family = DURATIONS.has(attribute) ? DURATIONS : new Set([attribute]);
			const same = task.attrs.filter((b) => family.has(b.keyword));
			if (same.length !== 1) continue;
			const file = snap.files.get(a.statement.file);
			if (!file) continue;
			const text = file.text;
			const line = text.lineAt(a.statement.from);
			if (text.lineAt(a.statement.to).number !== line.number) continue;
			const value = text.sliceString(a.value.from, a.value.to).trim();
			if (value.includes('$') || value.includes('\n')) continue;
			// The statement alone on its line (not `task a "A" { effort 1d }`).
			if (!new RegExp(`^\\s*${attribute}\\s`).test(line.text)) continue;
			if (line.text.trim().endsWith('}')) continue;
			out.push({ task, attribute, file: a.statement.file, line: line.number, value });
		}
	}
	return out;
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
 * The rewrite of a site to `value` through the edit API, or null when the edit API does not
 * rewrite that statement in place on its own line (another statement, a refusal, a no-op).
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
	const paths = Object.keys(r.edit.changes);
	if (paths.length !== 1 || paths[0] !== site.file) return null;
	const cs = r.edit.changes[site.file];
	const before = snap.files.get(site.file)?.text;
	if (!cs || !before) return null;
	const after = cs.apply(before);
	if (after.lines !== before.lines) return null;
	const at = before.line(site.line);
	let inPlace = true;
	cs.iterChangedRanges((from, to) => {
		if (from < at.from || to > at.to) inPlace = false;
	});
	if (!inPlace) return null;
	const newLine = after.line(site.line).text;
	const files: Record<string, string> = {};
	for (const [p, f] of snap.files) files[p] = p === site.file ? after.toString() : f.text.toString();
	// The value as written in the new statement: the line's text after the keyword.
	const written = newLine.trim().slice(site.attribute.length).trim().replace(/\s*(#|\/\/).*$/, '');
	return {
		site,
		edit: {
			task: site.task.id,
			attribute: site.attribute,
			scenario: null,
			value: written,
			file: site.file,
			line: site.line,
		},
		files,
	};
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

export { Rng };
