// SPDX-License-Identifier: GPL-2.0-or-later
// A range of the index's text in the text as it is now (range.ts).
import { describe, expect, it } from 'vitest';
import { createWorkspace } from '../workspace/workspace';
import { currentRange } from './range';

const TEXT = 'project p "P" 2026-01-05 +8w\ntask a "A" {}\n';

describe('currentRange', () => {
	it('maps a range through the changes made since the index, and leaves it without any', () => {
		const w = createWorkspace({ entry: 'plan.tjp', files: { 'plan.tjp': TEXT } });
		const v = w.snapshot().version;
		const st = w.state('plan.tjp');
		w.commit('plan.tjp', st.update({ changes: { from: 0, insert: '# new line\n' } }), 'typing');
		const r = { file: 'plan.tjp', from: 10, to: 20 };
		expect(currentRange(w, v, r)).toEqual({ file: 'plan.tjp', from: 21, to: 31 });
		expect(currentRange(w, undefined, r)).toBe(r);
	});
});
