// SPDX-License-Identifier: GPL-2.0-or-later
// The cursor to task mapping over random edits (phase-2.md 6.10): a burst of typing that the index
// has not seen (comment and blank lines, whole new tasks, whole tasks deleted), then every position
// of the text. The lagging answer never names a task the fresh index lacks, and outside the typed
// text it is the fresh index's answer, whatever the lag; each task the lagging index has gets the
// fresh index's block exactly. Positions inside typed text are only checked for the first rule
// (the index has nothing there).
import fc from 'fast-check';
import { describe, it } from 'vitest';
import { harness, type Harness } from './edits-testing';
import { sourceOf, taskAtCursor } from './selection.svelte';

const PLAN = [
	'project p "P" 2026-01-05 +1m',
	'resource r "R"',
	'task a "A" {',
	'  effort 1d',
	'  task a1 "A1" {',
	'    effort 1d',
	'    allocate r',
	'  }',
	'  task a2 "A2" { effort 2d }',
	'}',
	'task b "B" {',
	'  depends a',
	'  effort 2d',
	'}',
	'supplement task b {',
	'  priority 500',
	'}',
	'task c "C" { depends !b effort 1d }',
	'',
].join('\n');

/**
 * An edit at line granularity that keeps the text valid: a line typed in (a comment, a blank line,
 * a whole new task), or a whole top-level task deleted (never b, which the supplement names).
 */
type Edit = { kind: 'ins'; line: number; text: string } | { kind: 'delTask'; line: number };
const editArb: fc.Arbitrary<Edit> = fc.oneof(
	fc.record({
		kind: fc.constant('ins' as const),
		line: fc.nat(1000),
		text: fc.constantFrom('# note\n', '\n', '  # indented note\n', 'task n "N" { effort 1d }\n'),
	}),
	fc.record({ kind: fc.constant('delTask' as const), line: fc.nat(1000) }),
);

/** Applies an edit the way the editor commits typing (the index is not told). */
function apply(h: Harness, e: Edit): void {
	const state = h.ws.state('plan.tjp');
	const doc = state.doc;
	if (e.kind === 'ins') {
		h.type(e.text, doc.line(1 + (e.line % doc.lines)).from);
		return;
	}
	const text = doc.toString();
	const starts = [...text.matchAll(/^task (?!b )[a-z0-9]+ /gm)].map((m) => m.index ?? 0);
	const from = starts[e.line % Math.max(1, starts.length)];
	if (from === undefined) return;
	const lineEnd = text.indexOf('\n', from);
	const header = text.slice(from, lineEnd);
	const to = header.endsWith('}') ? lineEnd + 1 : text.indexOf('\n}\n', from) + 3;
	h.ws.commit('plan.tjp', state.update({ changes: { from, to } }), 'typing');
}

describe('cursor to task, over random edits', () => {
	it('never names a deleted task, and matches a fresh index outside the typed text', () => {
		fc.assert(
			fc.property(fc.array(editArb, { minLength: 1, maxLength: 6 }), (edits) => {
				const h = harness({ entry: 'plan.tjp', files: { 'plan.tjp': PLAN } });
				try {
					for (const e of edits) apply(h, e);
					const lagging = h.runner.state;
					// The index is of the text before the burst, or of some text between.
					const fresh = h.runner.ensureIndex();
					const freshRun = { ...lagging, index: fresh, indexVersion: h.ws.snapshot().version };
					const typed: Array<[number, number]> = [];
					h.ws
						.changesSince(lagging.indexVersion)
						.get('plan.tjp')
						?.iterChangedRanges((_a, _b, fromB, toB) => void typed.push([fromB, toB]));
					const length = h.ws.state('plan.tjp').doc.length;
					for (let pos = 0; pos <= length; pos++) {
						const got = taskAtCursor(lagging, h.ws, 'plan.tjp', pos);
						if (got !== null && !fresh.tasks.has(got)) return false;
						if (typed.some(([from, to]) => pos >= from && pos <= to)) continue;
						if (got !== taskAtCursor(freshRun, h.ws, 'plan.tjp', pos)) return false;
					}
					for (const id of fresh.tasks.keys()) {
						const want = sourceOf(freshRun, h.ws, id);
						const got = sourceOf(lagging, h.ws, id);
						// A task the lagging index does not have yet has no block; the others agree.
						if (got === null) {
							if (lagging.index.tasks.has(id)) return false;
							continue;
						}
						if (want === null || got.from !== want.from || got.to !== want.to) return false;
					}
					return true;
				} finally {
					h.dispose();
				}
			}),
			{ numRuns: 300 },
		);
	});

	it('answers a task or null at every position, whatever is typed, with the index never caught up', () => {
		fc.assert(
			fc.property(
				fc.array(fc.record({ at: fc.nat(1000), text: fc.string({ maxLength: 6 }) }), {
					minLength: 1,
					maxLength: 8,
				}),
				(edits) => {
					const h = harness({ entry: 'plan.tjp', files: { 'plan.tjp': PLAN } });
					try {
						for (const e of edits) {
							const len = h.ws.state('plan.tjp').doc.length;
							h.type(e.text, e.at % (len + 1));
						}
						const run = h.runner.state;
						const ids = new Set(run.index.tasks.keys());
						const length = h.ws.state('plan.tjp').doc.length;
						for (let pos = 0; pos <= length; pos++) {
							const id = taskAtCursor(run, h.ws, 'plan.tjp', pos);
							if (id !== null && !ids.has(id)) return false;
						}
						for (const id of ids) {
							const r = sourceOf(run, h.ws, id);
							if (r && (r.from > r.to || r.to > length)) return false;
						}
						return true;
					} finally {
						h.dispose();
					}
				},
			),
			{ numRuns: 60 },
		);
	});
});
