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
import type { FastEdit, ScheduleResult } from '../../src/engine/protocol';
import { applyIntent } from '../../src/lib/tjp/edit/apply';
import type { TaskAttr } from '../../src/lib/tjp/edit/types';
import { buildIndex, type EngineHints, type SymbolIndex } from '../../src/lib/tjp/index';
import { fastEditsOf, fastSites, type FastSite } from '../../src/lib/workspace/fast-patch';
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

export { Rng };
