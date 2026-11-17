// SPDX-License-Identifier: GPL-2.0-or-later
// A cursor inside a resource block selects that person (resource-cursor.ts), over the real
// workspace, runner and index, with an index that lags the text, as taskAtCursor's tests do.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { task } from '../workspace/testing/fake-engine-client';
import { harness, type Harness } from './edits-testing';
import { resourceAtCursor } from './resource-cursor';

const PLAN = [
	'project p "P" 2026-01-05 +1m',
	'resource team "Team" {',
	'  resource a "Ann" {',
	'    efficiency 0.8',
	'  }',
	'  resource b "Bob"',
	'}',
	'supplement resource b {',
	'  rate 400',
	'}',
	'task t "T" { effort 1d  allocate a }',
	'',
].join('\n');

let h: Harness;
beforeEach(async () => {
	h = harness({ entry: 'plan.tjp', files: { 'plan.tjp': PLAN } });
	await h.finish({ tasks: [task('t', 2, 600)] });
});
afterEach(() => h.dispose());

const at = (needle: string): number => {
	const i = h.text().indexOf(needle);
	if (i < 0) throw new Error(`no ${needle}`);
	return i;
};
const find = (pos: number) => resourceAtCursor(h.runner.state, h.ws, 'plan.tjp', pos);

describe('resourceAtCursor', () => {
	it('finds the resource whose block holds the cursor, the smallest around it', () => {
		expect(find(at('resource team') + 3)).toBe('team');
		expect(find(at('resource a "Ann"') + 3)).toBe('a');
		expect(find(at('efficiency'))).toBe('a');
		expect(find(at('resource b') + 3)).toBe('b');
	});

	it('finds a supplement through its target, and no resource in the header or a task', () => {
		expect(find(at('rate 400'))).toBe('b');
		expect(find(3)).toBeNull();
		expect(find(at('task t') + 2)).toBeNull();
		expect(find(h.text().length)).toBeNull();
	});

	it('maps the cursor back through edits the index has not seen', () => {
		h.type('# hi\n\n', 0);
		expect(h.runner.state.indexVersion).toBeLessThan(h.runner.state.version);
		expect(find(at('efficiency'))).toBe('a');
		expect(find(at('resource b') + 3)).toBe('b');
		expect(find(2)).toBeNull();
	});
});
