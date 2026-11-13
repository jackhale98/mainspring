// SPDX-License-Identifier: GPL-2.0-or-later
// The cursor to task mapping over random edits (phase-2.md 6.10): a burst of typing that the index
// has not seen, then every position of the text. The edits only add comment lines and blank lines
// at line starts, which never change what the plan declares, so the task at a position that was
// not typed is the one a fresh index finds, whatever the lag, and each task's block is the fresh
// index's block exactly. Positions inside typed text are not compared (the index has nothing
// there; they map to the place of the insertion).
import fc from 'fast-check';
import { describe, it } from 'vitest';
import { harness } from './edits-testing';
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

/** An edit: where (a line of the text, 0 based, by share) and what to type there. */
const editArb = fc.record({
	line: fc.nat(1000),
	text: fc.constantFrom('# note\n', '\n', '  # indented note\n', '# a\n# b\n'),
});

describe('cursor to task, over random edits', () => {
	it('matches a fresh index outside the typed text, and blocks equal the fresh blocks', () => {
		fc.assert(
			fc.property(fc.array(editArb, { minLength: 1, maxLength: 12 }), (edits) => {
				const h = harness({ entry: 'plan.tjp', files: { 'plan.tjp': PLAN } });
				try {
					for (const e of edits) {
						const doc = h.ws.state('plan.tjp').doc;
						const line = doc.line(1 + (e.line % doc.lines));
						h.type(e.text, line.from);
					}
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
						if (typed.some(([from, to]) => pos >= from && pos <= to)) continue;
						const want = taskAtCursor(freshRun, h.ws, 'plan.tjp', pos);
						const got = taskAtCursor(lagging, h.ws, 'plan.tjp', pos);
						if (got !== want) return false;
					}
					for (const id of fresh.tasks.keys()) {
						const want = sourceOf(freshRun, h.ws, id);
						const got = sourceOf(lagging, h.ws, id);
						if (want === null || got === null) return false;
						if (got.from !== want.from || got.to !== want.to) return false;
					}
					return true;
				} finally {
					h.dispose();
				}
			}),
			{ numRuns: 60 },
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
