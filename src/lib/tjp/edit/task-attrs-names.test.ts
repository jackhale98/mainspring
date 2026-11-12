// SPDX-License-Identifier: GPL-2.0-or-later
// renameTask and declareFlag (phase-1.md 7.1, T11a): exact text changes, no-ops and refusals,
// through the plan's wrappers (task-attrs-api.ts) and applyIntent.
import { describe, expect, it } from 'vitest';
import { applyIntent } from './apply';
import { declareFlag, renameTask } from './task-attrs-api';
import { setup, textsAfter } from './testing';
import type { EditIntent } from './types';

const HEAD = 'project p "P" 2026-01-05 +2m\nresource r "R"\nflags hot, cold\n';

/** The entry file's text after an intent (throws unless it is an edit). */
function after(src: string, intent: EditIntent): string {
	const s = setup(src);
	return textsAfter(s.snap, applyIntent(s.snap, s.index, intent))['plan.tjp'] ?? '';
}

describe('renameTask', () => {
	it('rewrites the name string in its quote style', () => {
		const src = HEAD + 'task a \'A\' {\n  effort 1d\n}\ntask b "B"\n';
		const s = setup(src);
		const r = renameTask(s.snap, s.index, 'a', "Al's");
		expect(textsAfter(s.snap, r)['plan.tjp']).toBe(src.replace("'A'", "'Al\\'s'"));
		expect(after(src, { type: 'renameTask', task: 'b', name: 'Say "x"' })).toBe(
			src.replace('"B"', '"Say \\"x\\""'),
		);
		expect(renameTask(s.snap, s.index, 'b', 'B')).toMatchObject({ reason: 'already-set' });
	});

	it('turns a cut-here name into a quoted one', () => {
		const src = HEAD + 'task a -8<-\n  Long\n  ->8- {\n  effort 1d\n}\n';
		expect(after(src, { type: 'renameTask', task: 'a', name: 'Short' })).toBe(
			HEAD + 'task a "Short" {\n  effort 1d\n}\n',
		);
	});

	it('refuses unsafe names and templated names', () => {
		const s = setup(HEAD + 'macro n [x]\ntask a "A"\ntask b "${n} B"\n');
		for (const name of ['${x}', '$(HOME)', 'two\nlines', 'back\\']) {
			expect(renameTask(s.snap, s.index, 'a', name)).toMatchObject({ reason: 'unsafe-text' });
		}
		expect(renameTask(s.snap, s.index, 'b', 'B')).toMatchObject({ reason: 'text-only' });
	});
});

describe('declareFlag', () => {
	it('appends to the last file-level declaration', () => {
		const s = setup(HEAD + 'flags x\ntask a "A"\n');
		const r = declareFlag(s.snap, s.index, 'warm');
		expect(textsAfter(s.snap, r)['plan.tjp']).toBe(HEAD + 'flags x, warm\ntask a "A"\n');
		expect(declareFlag(s.snap, s.index, 'hot')).toMatchObject({ reason: 'already-set' });
		expect(declareFlag(s.snap, s.index, 'no way')).toMatchObject({ reason: 'invalid-value' });
	});

	it('inserts a declaration before the first task, above its comments', () => {
		const head = 'project p "P" 2026-01-05 +2m\n';
		expect(after(head + '# first\ntask a "A"\n', { type: 'declareFlag', flag: 'f' })).toBe(
			head + 'flags f\n# first\ntask a "A"\n',
		);
		expect(after(head, { type: 'declareFlag', flag: 'f' })).toBe(head + 'flags f\n');
	});
});

describe('macro neighbours', () => {
	it('refuses an append whose next token is a macro call', () => {
		const src =
			'macro more [, cold]\nproject p "P" 2026-01-05 +2m\nflags hot\n${more}\ntask a "A"\n';
		const s = setup(src);
		const r = declareFlag(s.snap, s.index, 'warm');
		expect(r).toMatchObject({ status: 'refused', reason: 'text-only' });
		expect(s.snap.files.get('plan.tjp')?.text.toString()).toBe(src);
	});
});
