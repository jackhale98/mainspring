// SPDX-License-Identifier: GPL-2.0-or-later
// One fidelity case (phase-1.md 9.3): a plan, an intent, the result of the edit API and the text-only
// properties P1 (locality), P2 (still parses), P3 (semantics), P5 (refusals, macros) and P6 (inverse).
// P4 (still schedules) needs the engine and lives in schedule.property.test.ts.
import type { ChangeSet } from '@codemirror/state';
import { applyEdit, applyIntent, formatFile, undoEdit } from '../../src/lib/tjp/edit/apply';
import type { EditIntent, EditResult, IntentType, TjpEdit } from '../../src/lib/tjp/edit/types';
import { buildIndex } from '../../src/lib/tjp/index';
import { syntaxIssues } from '../../src/lib/tjp/tree';
import {
	createWorkspace,
	type Workspace,
	type WorkspaceSnapshot,
} from '../../src/lib/workspace/workspace';
import { canonSem, semOf, type Facts, type Rg, type Sem } from './gen/facts';
import type { Change, Drawn, Family } from './families/types';
import { factsFromIndex } from './oracle';

/** The edit API as the property tests call it; mutation.test.ts wraps it with faulty versions. */
export type ApplyFn = (
	snap: WorkspaceSnapshot,
	index: ReturnType<typeof buildIndex>,
	intent: EditIntent,
) => EditResult;
export const realApply: ApplyFn = (snap, index, intent) =>
	intent.type === 'format' ? formatFile(snap, intent.file) : applyIntent(snap, index, intent);

export interface Case {
	readonly seed: number;
	readonly source: 'generated' | 'corpus';
	readonly name: string;
	readonly type: IntentType;
	readonly entry: string;
	readonly files: Readonly<Record<string, string>>;
	readonly facts: Facts;
	/** The semantics before the edit. */
	readonly sem: Sem;
	readonly drawn: Drawn;
	readonly family: Family;
	/** For a corpus plan: the golden's `now`. */
	readonly now: string | null;
}

export interface Outcome {
	readonly type: IntentType;
	readonly source: Case['source'];
	readonly status: EditResult['status'];
	readonly reason: string | null;
	readonly failures: string[];
	readonly changes: number;
	readonly ms: number;
	/** The texts after the edit (edits only). */
	readonly after: Record<string, string> | null;
}

export function changesOf(edit: TjpEdit): Change[] {
	const out: Change[] = [];
	for (const [file, cs] of Object.entries(edit.changes) as Array<[string, ChangeSet]>) {
		cs.iterChanges((from, to, _fb, _tb, ins) =>
			out.push({ file, from, to, insert: ins.toString() }),
		);
	}
	return out;
}

/** Whether [from, to] lies in the union of `ranges` (adjacent ranges count as one). */
export function covered(
	c: { from: number; to: number },
	ranges: readonly { from: number; to: number }[],
): boolean {
	const rs = [...ranges].sort((a, b) => a.from - b.from);
	let at = c.from;
	let reached = false;
	for (const r of rs) {
		if (r.from <= at && r.to >= at) {
			at = Math.max(at, r.to);
			reached = true;
		}
	}
	return reached && at >= c.to;
}

const errorCount = (snap: WorkspaceSnapshot): number =>
	[...snap.files.values()].reduce((n, f) => n + syntaxIssues(f.tree, f.text).length, 0);

const texts = (snap: WorkspaceSnapshot): Record<string, string> =>
	Object.fromEntries([...snap.files].map(([p, f]) => [p, f.text.toString()]));

/** The first lines where two JSON values differ, for a failure message. */
export function diffJson(a: unknown, b: unknown, max = 6): string {
	const A = JSON.stringify(a, null, 1).split('\n');
	const B = JSON.stringify(b, null, 1).split('\n');
	const out: string[] = [];
	for (let i = 0; i < Math.max(A.length, B.length) && out.length < max; i++) {
		if (A[i] !== B[i]) out.push(`  expected ${A[i]?.trim()} | got ${B[i]?.trim()}`);
	}
	return out.join('\n');
}

export function runCase(c: Case, apply: ApplyFn = realApply, load = loadWorkspace): Outcome {
	const t0 = performance.now();
	const failures: string[] = [];
	const fail = (p: string, msg: string): void => void failures.push(`${p}: ${msg}`);
	const ws = load(c);
	const snap0 = ws.snapshot();
	const index0 = buildIndex(snap0, undefined, { cache: null });
	const before = texts(snap0);
	const r = apply(snap0, index0, c.drawn.intent);
	const done = (after: Record<string, string> | null, changes = 0): Outcome => ({
		type: c.type,
		source: c.source,
		status: r.status,
		reason: r.status === 'edit' ? null : r.reason,
		failures,
		changes,
		ms: performance.now() - t0,
		after,
	});

	// P5: an edit function is pure, and a refusal or no-op changes nothing.
	const afterCall = ws.snapshot();
	if (
		afterCall.version !== snap0.version ||
		JSON.stringify(texts(afterCall)) !== JSON.stringify(before)
	) {
		fail('P5', 'the edit call changed the workspace');
	}
	if (c.drawn.mustRefuse) {
		if (r.status !== 'refused')
			fail('P5', `an intent at text-only text was ${r.status}, not refused`);
		else if (!c.drawn.mustRefuse.includes(r.reason))
			fail('P5', `refused as ${r.reason}, expected ${c.drawn.mustRefuse.join(' or ')}`);
	}
	if (r.status !== 'edit') return done(null);

	const edit = r.edit;
	const changes = changesOf(edit);
	const region = c.family.region(c.drawn.intent, c.facts);
	// P1: every change lies in the oracle's region, and in the edit's own declared targets.
	for (const ch of changes) {
		const where = `${ch.file}[${ch.from},${ch.to}) ${JSON.stringify(ch.insert.slice(0, 40))}`;
		if (typeof region === 'function') {
			if (!region(ch, c.facts)) fail('P1', `change outside the oracle region: ${where}`);
		} else if (
			!covered(
				ch,
				region.filter((x: Rg) => x.file === ch.file),
			)
		) {
			fail('P1', `change outside the oracle region: ${where}`);
		}
		if (
			!covered(
				ch,
				(edit.targets[ch.file] ?? []).filter(() => true),
			)
		)
			fail('P1', `change outside the edit's declared targets: ${where}`);
	}
	// P5: no edit changes a macro body or call (removing a call whole is allowed).
	for (const ch of changes) {
		for (const m of c.facts.macroRanges) {
			if (m.file !== ch.file) continue;
			const hits = ch.from < m.to && ch.to > m.from;
			const strictlyInside = ch.from === ch.to && ch.from > m.from && ch.from < m.to;
			if ((hits || strictlyInside) && !(ch.from <= m.from && ch.to >= m.to)) {
				fail('P5', `change touches a macro at ${m.file}[${m.from},${m.to})`);
			}
		}
	}

	const applied = applyEdit(ws, edit);
	if (applied === 'stale') {
		fail('apply', 'Workspace.apply reported stale on the snapshot the edit was made for');
		return done(null, changes.length);
	}
	const snap1 = ws.snapshot();
	const after = texts(snap1);
	// P2: no new error nodes (none at all in a generated plan).
	const errs0 = errorCount(snap0);
	const errs1 = errorCount(snap1);
	if (errs1 > errs0 || (c.source === 'generated' && errs1 > 0))
		fail('P2', `error nodes ${errs0} -> ${errs1}`);
	// P3: the rebuilt index reads what the model says.
	const index1 = buildIndex(snap1, undefined, { cache: null });
	const sem1 = semOf(factsFromIndex(snap1, index1));
	const expected = c.family.expect(c.sem, c.facts, c.drawn.intent);
	if (JSON.stringify(canonSem(sem1)) !== JSON.stringify(canonSem(expected))) {
		fail(
			'P3',
			`the index reads differently than the model\n${diffJson(canonSem(expected), canonSem(sem1))}`,
		);
	}
	// P6: undoing restores the text byte for byte.
	const undo = undoEdit(applied, snap1);
	if (!undo) fail('P6', 'undoEdit has no inverse for the applied edit');
	else if (ws.apply(undo) !== 'applied') fail('P6', 'the inverse did not apply');
	else {
		const back = texts(ws.snapshot());
		for (const p of Object.keys(before))
			if (back[p] !== before[p]) fail('P6', `${p} differs after the inverse`);
	}
	return done(after, changes.length);
}

export function loadWorkspace(c: Case): Workspace {
	return createWorkspace({ entry: c.entry, files: { ...c.files } });
}
