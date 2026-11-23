// SPDX-License-Identifier: GPL-2.0-or-later
// Realistic merge sides for the property tests (phase-4.md 13.1): plans and intents from the
// patch-fidelity suite (tests/fidelity: generated plans with CRLF, tabs, macros, supplements and
// prefixed includes, and the per-push golden plans), applied through the real edit API.
import { ENFORCED, familyOf } from '../../../../tests/fidelity/families';
import type { Change } from '../../../../tests/fidelity/families/types';
import { corpusCase, corpusPlan, generatedCase } from '../../../../tests/fidelity/cases';
import { changesOf, INDEX_OPTIONS, realApply, type Case } from '../../../../tests/fidelity/harness';
import { goldenHints } from '../../../../tests/fidelity/oracle';
import { mixSeed, Rng } from '../../../../tests/fidelity/gen/rng';
import { createWorkspace } from '../../workspace/workspace';
import type { EditIntent, IntentType } from '../edit/types';
import { buildIndex } from '../index';

export type Texts = Readonly<Record<string, string>>;

export interface Plan {
	readonly name: string;
	readonly entry: string;
	readonly files: Texts;
	readonly c: Pick<Case, 'facts' | 'sem' | 'result'>;
}

/** A plan for `seed`: a generated plan, or every third one a golden plan of the per-push list. */
export function planOf(seed: number): Plan {
	const type = ENFORCED[seed % ENFORCED.length] as IntentType;
	const c = seed % 3 === 0 ? corpusCase(seed, type) : generatedCase(seed, type);
	return { name: c.name, entry: c.entry, files: c.files, c };
}

/** A golden plan by id, or null when the index names no task in it. */
export function goldenPlan(id: string): Plan | null {
	const c = corpusPlan(id);
	return c ? { name: id, entry: c.entry, files: c.files, c } : null;
}

/** An intent of one of `types` drawn against the plan's base facts, or null. */
export function drawIntent(p: Plan, seed: number, types: readonly IntentType[]): EditIntent | null {
	const rng = new Rng(mixSeed(seed, 0x5eed));
	for (let i = 0; i < 8; i++) {
		const type = types[rng.int(0, types.length - 1)] as IntentType;
		const d = familyOf(type).draw(type, p.c.facts, p.c.sem, rng);
		if (d && !d.mustRefuse) return d.intent;
	}
	return null;
}

export interface Applied {
	readonly files: Record<string, string>;
	readonly changes: readonly Change[];
}

/** `intent` applied to `files` (the plan's, or a side's) by the edit API; null unless it edits. */
export function applyTo(p: Plan, files: Texts, intent: EditIntent): Applied | null {
	return applier(p, files)(intent);
}

/** `applyTo` for many intents on the same files: the workspace and index are built once. */
export function applier(p: Plan, files: Texts): (intent: EditIntent) => Applied | null {
	const snap = createWorkspace({ entry: p.entry, files: { ...files } }).snapshot();
	const hints = p.c.result ? goldenHints(p.c.result, snap) : undefined;
	const index = buildIndex(snap, hints, INDEX_OPTIONS);
	return (intent) => {
		const r = realApply(snap, index, intent);
		if (r.status !== 'edit') return null;
		const out: Record<string, string> = {};
		for (const [path, f] of snap.files) {
			const cs = r.edit.changes[path];
			out[path] = cs ? cs.apply(f.text).toString() : f.text.toString();
		}
		return { files: out, changes: changesOf(r.edit) };
	};
}

/** `files` with changes made in their coordinates, which must not overlap. */
export function withChanges(files: Texts, changes: readonly Change[]): Record<string, string> {
	const out: Record<string, string> = { ...files };
	const sorted = [...changes].sort((x, y) => y.from - x.from);
	for (const c of sorted) {
		const t = out[c.file] ?? '';
		out[c.file] = t.slice(0, c.from) + c.insert + t.slice(c.to);
	}
	return out;
}

/** The tasks an intent edits the text of (null: it may edit anywhere). */
export function touched(i: EditIntent): readonly string[] | null {
	switch (i.type) {
		case 'setAttr':
		case 'removeAttr':
		case 'addDepends':
		case 'removeDepends':
		case 'setDependsGap':
		case 'allocate':
		case 'addAllocation':
		case 'removeAllocation':
		case 'replaceAllocation':
			return [i.task];
		case 'renameTask':
			return i.id === undefined ? [i.task] : null;
		default:
			return null;
	}
}

/** Intent types that edit one task's own text (the commutation property, 13.1). */
export const LOCAL: readonly IntentType[] = [
	'setAttr',
	'removeAttr',
	'renameTask',
	'addDepends',
	'removeDepends',
	'setDependsGap',
	'allocate',
	'addAllocation',
	'removeAllocation',
	'replaceAllocation',
].filter((t) => ENFORCED.includes(t as IntentType)) as IntentType[];

/** Whether two edits insert at the same place (13.1 leaves those out: rule 3's conflict). */
export function addsAtSamePlace(x: readonly Change[], y: readonly Change[]): boolean {
	return x.some((a) =>
		y.some((b) => a.file === b.file && a.from === a.to && b.from === b.to && a.from === b.from),
	);
}

/** Whether two edits change overlapping or touching text. */
export function touching(x: readonly Change[], y: readonly Change[]): boolean {
	return x.some((a) => y.some((b) => a.file === b.file && a.from <= b.to && b.from <= a.to));
}

export interface TwoSides {
	readonly p: Plan;
	readonly a: {
		intent: EditIntent;
		files: Record<string, string>;
		changes: ReturnType<typeof applyTo>;
	};
	readonly b: {
		intent: EditIntent;
		files: Record<string, string>;
		changes: ReturnType<typeof applyTo>;
	};
}

/** A plan and two intents that both edit it, or null. */
export function twoSides(seed: number, types = ENFORCED, more = 0): TwoSides | null {
	const p = planOf(seed);
	const ia = drawIntent(p, seed * 2 + 1, types);
	const ib = drawIntent(p, seed * 2 + 2, types);
	if (!ia || !ib) return null;
	const a = applyTo(p, p.files, ia);
	const b = applyTo(p, p.files, ib);
	if (!a || !b) return null;
	/** `more` further intents on a side, drawn against the base and applied in turn where they edit. */
	const extra = (files: Record<string, string>, salt: number): Record<string, string> => {
		let out = files;
		for (let i = 0; i < more; i++) {
			const intent = drawIntent(p, seed * 31 + salt * 7 + i, types);
			const r = intent ? applyTo(p, out, intent) : null;
			if (r) out = r.files;
		}
		return out;
	};
	return {
		p,
		a: { intent: ia, files: extra(a.files, 1), changes: a },
		b: { intent: ib, files: extra(b.files, 2), changes: b },
	};
}
