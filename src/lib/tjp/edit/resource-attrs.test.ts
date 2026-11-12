// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { applyIntent } from './apply';
import { removeResourceAttr, setResourceAttr } from './resources';
import { setup, textsAfter } from './testing';
import type { EditIntent, EditOptions, EditResult } from './types';

const PLAN = `project p "P" 2026-01-05 - 2026-03-27 {
  now 2026-02-02
}

resource team "Team" {
  efficiency 1.0
  resource ann "Ann" {
    email "a@x"
  }

  resource bob "Bob"
}
# about cid
resource cid "Cid" {
  managers ann
}

task t "T" {
  effort 3d
  allocate bob, cid
  responsible cid
}
`;

function run(
	intent: EditIntent,
	files: Record<string, string> | string = PLAN,
	opts?: EditOptions,
) {
	const s = setup(files, opts);
	return { s, r: applyIntent(s.snap, s.index, intent, opts) };
}

function after(
	intent: EditIntent,
	files: Record<string, string> | string = PLAN,
	path = 'plan.tjp',
) {
	const { s, r } = run(intent, files);
	return textsAfter(s.snap, r)[path];
}

const status = (r: EditResult): string =>
	r.status === 'edit' ? 'edit' : `${r.status}:${r.reason}`;

describe('setResourceAttr and removeResourceAttr', () => {
	it('rewrites the last own site, keeping the spelling, else inserts by 7.2 order', () => {
		expect(
			after({ type: 'setResourceAttr', resource: 'team', attr: 'efficiency', value: '2' }),
		).toContain('  efficiency 2\n');
		const s = setup(PLAN);
		expect(setResourceAttr(s.snap, s.index, 'team', 'efficiency', '1.0').status).toBe('noop');
		expect(
			after({ type: 'setResourceAttr', resource: 'ann', attr: 'rate', value: '300' }),
		).toContain('    email "a@x"\n    rate 300\n  }');
		expect(
			after({ type: 'setResourceAttr', resource: 'team', attr: 'email', value: '"t@x"' }),
		).toContain('resource team "Team" {\n  email "t@x"\n  efficiency 1.0');
	});

	it('inserts before another scenario prefixed site of the attribute', () => {
		const sc = PLAN.replace(
			'now 2026-02-02',
			'now 2026-02-02\n  scenario plan "Plan" { scenario late "Late" }',
		).replace('  managers ann\n', '  late:efficiency 0.5\n  managers ann\n');
		expect(
			after({ type: 'setResourceAttr', resource: 'cid', attr: 'efficiency', value: '2.0' }, sc),
		).toContain('resource cid "Cid" {\n  efficiency 2.0\n  late:efficiency 0.5\n  managers ann\n}');
	});

	it('edits the last site in a supplement', () => {
		const sup = PLAN + 'supplement resource bob {\n  rate 100\n}\n';
		expect(
			after({ type: 'setResourceAttr', resource: 'bob', attr: 'rate', value: '120' }, sup),
		).toContain('supplement resource bob {\n  rate 120\n}');
		expect(after({ type: 'removeResourceAttr', resource: 'bob', attr: 'rate' }, sup)).toContain(
			'supplement resource bob {\n}',
		);
	});

	it('sets managers as the whole list', () => {
		expect(
			after({ type: 'setResourceAttr', resource: 'cid', attr: 'managers', value: ['ann', 'bob'] }),
		).toContain('  managers ann, bob\n');
		const s = setup(PLAN);
		const set = (r: string, v: string | string[]): string =>
			status(setResourceAttr(s.snap, s.index, r, 'managers', v));
		expect(set('cid', 'ann')).toBe('noop:already-set');
		expect(set('cid', 'cid')).toBe('refused:invalid-value');
		expect(set('cid', 'team')).toBe('refused:invalid-value');
		expect(set('cid', 'zzz')).toBe('refused:invalid-value');
	});

	it('refuses inherited values, invalid values, macro bodies and text-only sites', () => {
		const s = setup(PLAN);
		expect(status(removeResourceAttr(s.snap, s.index, 'ann', 'efficiency'))).toBe(
			'refused:inherited',
		);
		expect(status(removeResourceAttr(s.snap, s.index, 'ann', 'rate'))).toBe('noop:not-present');
		expect(status(setResourceAttr(s.snap, s.index, 'ann', 'rate', '-3'))).toBe(
			'refused:invalid-value',
		);
		expect(status(setResourceAttr(s.snap, s.index, 'ann', 'email', 'x'))).toBe(
			'refused:invalid-value',
		);
		const macro =
			'project p "P" 2026-01-05 +1m\nmacro e [ efficiency 2 ]\nresource a "A" {\n  ${e}\n}\n';
		expect(
			status(
				run({ type: 'setResourceAttr', resource: 'a', attr: 'efficiency', value: '1' }, macro).r,
			),
		).toBe('refused:macro-in-body');
		expect(
			status(run({ type: 'setResourceAttr', resource: 'a', attr: 'rate', value: '1' }, macro).r),
		).toBe('edit');
		const valueMacro =
			'project p "P" 2026-01-05 +1m\nmacro e [2]\nresource a "A" {\n  efficiency ${e}\n}\n';
		expect(
			status(
				run({ type: 'setResourceAttr', resource: 'a', attr: 'efficiency', value: '1' }, valueMacro)
					.r,
			),
		).toBe('refused:text-only');
	});
});

describe('shared files (15.16)', () => {
	const files = {
		'plan.tjp':
			'project p "P" 2026-01-05 +1m\nresource g1 "G1"\nresource g2 "G2"\n' +
			'include "r.tji" { resourceprefix g1 }\n',
		'r.tji': 'resource k "K" {\n  efficiency 1.0\n}\n',
	};

	it('lets a confirmed value rewrite through and refuses structural edits', () => {
		expect(
			status(
				run({ type: 'setResourceAttr', resource: 'k', attr: 'efficiency', value: '2.0' }, files).r,
			),
		).toBe('edit');
		const twice = {
			...files,
			'plan.tjp': files['plan.tjp'] + 'include "r.tji" { resourceprefix g2 }\n',
		};
		const value: EditIntent = {
			type: 'setResourceAttr',
			resource: 'k',
			attr: 'efficiency',
			value: '2.0',
		};
		expect(status(run(value, twice).r)).toBe('refused:shared-declaration');
		expect(status(run(value, twice, { confirmShared: true }).r)).toBe('edit');
		const del: EditIntent = { type: 'deleteResource', resource: 'k' };
		expect(status(run(del, twice, { confirmShared: true }).r)).not.toBe('edit');
	});
});
