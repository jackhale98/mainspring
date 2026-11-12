// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { applyIntent } from './apply';
import { addResource, deleteResource, moveResource, renameResource } from './resources';
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

describe('addResource', () => {
	it('inserts after sibling index-1, copying its blank-line separation', () => {
		expect(after({ type: 'addResource', parent: 'team', index: 2, name: 'Dee' })).toContain(
			'  resource bob "Bob"\n\n  resource dee "Dee"\n}',
		);
		expect(after({ type: 'addResource', parent: 'team', index: 1, name: 'Dee' })).toContain(
			'    email "a@x"\n  }\n  resource dee "Dee"\n\n  resource bob',
		);
	});

	it('inserts before the first sibling at index 0', () => {
		expect(after({ type: 'addResource', parent: 'team', index: 0, name: 'Dee' })).toContain(
			'  efficiency 1.0\n  resource dee "Dee"\n  resource ann',
		);
	});

	it('writes attributes in 7.2 order and opens a body for a leaf parent', () => {
		const text = after({
			type: 'addResource',
			parent: 'bob',
			index: 0,
			id: 'eve',
			name: 'Eve',
			attrs: [
				['rate', '400'],
				['efficiency', '0.5'],
				['managers', 'ann'],
				['email', '"e@x"'],
			],
		});
		expect(text).toContain(
			'  resource bob "Bob" {\n    resource eve "Eve" {\n      email "e@x"\n      managers ann\n' +
				'      efficiency 0.5\n      rate 400\n    }\n  }\n',
		);
	});

	it('appends a root after the last root, and places a first root before the first task', () => {
		expect(after({ type: 'addResource', parent: null, index: 99, name: 'Zed' })).toContain(
			'  managers ann\n}\nresource zed "Zed"\n\ntask t',
		);
		const bare = 'project p "P" 2026-01-05 +1m\n\ntask t "T" { duration 1d }\n';
		expect(after({ type: 'addResource', parent: null, index: 0, name: 'Zed' }, bare)).toBe(
			'project p "P" 2026-01-05 +1m\nresource zed "Zed"\n\ntask t "T" { duration 1d }\n',
		);
	});

	it('makes ids from names, with a suffix on collision', () => {
		expect(after({ type: 'addResource', parent: null, index: 9, name: 'Ann' })).toContain(
			'resource ann_2 "Ann"',
		);
		expect(after({ type: 'addResource', parent: null, index: 9, name: 'Jo Ö-x' })).toContain(
			'resource jo_o_x "Jo Ö-x"',
		);
	});

	it('refuses collisions, bad ids, unsafe names and bad values', () => {
		const add = (x: Partial<EditIntent & { type: 'addResource' }>): string =>
			status(run({ type: 'addResource', parent: null, index: 0, name: 'N', ...x }).r);
		expect(add({ id: 'bob' })).toBe('refused:id-collision');
		expect(add({ id: 'a.b' })).toBe('refused:invalid-value');
		expect(add({ name: 'x ${y}' })).toBe('refused:unsafe-text');
		expect(add({ name: 'a\nb' })).toBe('refused:unsafe-text');
		expect(add({ attrs: [['efficiency', '-1']] })).toBe('refused:invalid-value');
		expect(add({ attrs: [['managers', 'team']] })).toBe('refused:invalid-value');
		expect(add({ attrs: [['managers', 'nobody']] })).toBe('refused:invalid-value');
		expect(add({ parent: 'nobody' })).toBe('refused:unknown-target');
	});

	it('refuses to turn a leaf that must stay one into a group', () => {
		// manager_is_group
		expect(status(run({ type: 'addResource', parent: 'ann', index: 0, name: 'Kid' }).r)).toBe(
			'refused:conflicting-attribute',
		);
		// booking_group: a booking in a task names bob
		const booked = PLAN.replace('responsible cid', 'responsible cid\n  booking bob 2026-01-05 +1h');
		expect(
			status(run({ type: 'addResource', parent: 'bob', index: 0, name: 'Kid' }, booked).r),
		).toBe('refused:conflicting-attribute');
		// leaf_resource_id_expected: a task limit names bob
		const limited = PLAN.replace(
			'responsible cid',
			'responsible cid\n  limits { dailymax 4h { resources bob } }',
		);
		expect(
			status(run({ type: 'moveResource', resource: 'cid', parent: 'bob', index: 0 }, limited).r),
		).toBe('refused:conflicting-attribute');
		expect(status(run({ type: 'moveResource', resource: 'cid', parent: 'bob', index: 0 }).r)).toBe(
			'edit',
		);
	});

	it('keeps CRLF breaks and tab indentation', () => {
		const crlf = 'project p "P" 2026-01-05 +1m\r\nresource g "G" {\r\n\tresource a "A"\r\n}\r\n';
		expect(after({ type: 'addResource', parent: 'g', index: 1, name: 'B' }, crlf)).toBe(
			'project p "P" 2026-01-05 +1m\r\nresource g "G" {\r\n\tresource a "A"\r\n\tresource b "B"\r\n}\r\n',
		);
	});

	it('the wrapper builds the intent', () => {
		const s = setup(PLAN);
		expect(addResource(s.snap, s.index, null, 0, 'zz', 'Z').status).toBe('edit');
	});
});

describe('deleteResource', () => {
	it('removes the block, its comments and the items naming it', () => {
		const text = after({ type: 'deleteResource', resource: 'cid' });
		expect(text).not.toContain('cid');
		expect(text).toContain('  allocate bob\n}');
		expect(text).not.toContain('responsible');
	});

	it('removes a group with its members, their supplements and managers items', () => {
		const files =
			PLAN.replace('allocate bob, cid', 'allocate cid') +
			'supplement resource ann {\n  rate 1\n}\n';
		const text = after({ type: 'deleteResource', resource: 'team' }, files);
		expect(text).not.toMatch(/team|ann|bob|supplement/);
		expect(text).toContain('resource cid "Cid" {\n}');
	});

	it('refuses to leave an effort task without allocations', () => {
		const only = PLAN.replace('allocate bob, cid', 'allocate bob');
		const { r } = run({ type: 'deleteResource', resource: 'team' }, only);
		expect(r).toMatchObject({ status: 'refused', reason: 'conflicting-attribute' });
		expect(status(run({ type: 'deleteResource', resource: 'team' }).r)).toBe('edit');
	});

	it('refuses references it cannot fix: bookings, macro bodies, resourceprefix', () => {
		const booking = PLAN.replace(
			'responsible cid',
			'responsible cid\n  booking bob 2026-01-05 +1h',
		);
		expect(status(run({ type: 'deleteResource', resource: 'bob' }, booking).r)).toBe(
			'refused:unfixable-reference',
		);
		const macro = PLAN.replace('task t', 'macro who [ allocate cid ]\ntask t');
		expect(status(run({ type: 'deleteResource', resource: 'cid' }, macro).r)).toBe(
			'refused:unfixable-reference',
		);
		const files = {
			'plan.tjp':
				'project p "P" 2026-01-05 +1m\nresource g "G"\ninclude "x.tji" { resourceprefix g }\n',
			'x.tji': 'resource k "K"\n',
		};
		expect(status(run({ type: 'deleteResource', resource: 'g' }, files).r)).toBe(
			'refused:unfixable-reference',
		);
	});

	it('refuses blocks that hold statement-level macro calls it cannot see through', () => {
		const m = PLAN.replace('    email "a@x"\n', '    email "a@x"\n    ${extra}\n');
		expect(run({ type: 'deleteResource', resource: 'ann' }, m).r.status).toBe('refused');
		expect(run({ type: 'moveResource', resource: 'ann', parent: null, index: 0 }, m).r.status).toBe(
			'refused',
		);
	});

	it('the wrapper builds the intent', () => {
		const s = setup(PLAN);
		expect(deleteResource(s.snap, s.index, 'nobody')).toMatchObject({ reason: 'unknown-target' });
	});
});

describe('moveResource', () => {
	it('moves a block with its comments into a group, re-indented', () => {
		const text = after({ type: 'moveResource', resource: 'cid', parent: 'team', index: 0 });
		expect(text).toContain(
			'  efficiency 1.0\n  # about cid\n  resource cid "Cid" {\n    managers ann\n  }\n  resource ann',
		);
		expect(text).not.toContain('}\n# about');
	});

	it('moves out to the top level and converts the indent unit', () => {
		const tabs =
			'project p "P" 2026-01-05 +1m\nresource g "G" {\n\tresource a "A" {\n\t\trate 1\n\t}\n}\n';
		expect(after({ type: 'moveResource', resource: 'a', parent: null, index: 1 }, tabs)).toBe(
			'project p "P" 2026-01-05 +1m\nresource g "G" {\n}\nresource a "A" {\n\trate 1\n}\n',
		);
	});

	it('refuses cycles, keeps noops, and refuses moving past an allocation', () => {
		expect(status(run({ type: 'moveResource', resource: 'team', parent: 'bob', index: 0 }).r)).toBe(
			'refused:cycle',
		);
		expect(status(run({ type: 'moveResource', resource: 'bob', parent: 'team', index: 1 }).r)).toBe(
			'noop:already-set',
		);
		const late = PLAN + 'resource late "Late"\n';
		expect(
			status(run({ type: 'moveResource', resource: 'bob', parent: 'late', index: 0 }, late).r),
		).toBe('refused:unfixable-reference');
		expect(status(run({ type: 'moveResource', resource: 'cid', parent: 'ann', index: 0 }).r)).toBe(
			'refused:conflicting-attribute',
		);
	});

	it('refuses overlapping inherited shift assignments (shift_assignment_overlap)', () => {
		const shifts =
			'project p "P" 2026-01-05 +2m\nshift s "S" { workinghours mon 9:00 - 12:00 }\n' +
			'resource a "A" {\n  shifts s 2026-01-05 - 2026-02-01\n}\nresource b "B" {\n  shifts s 2026-01-05 - 2026-02-01\n}\nresource c "C"\n';
		expect(
			status(run({ type: 'moveResource', resource: 'b', parent: 'a', index: 0 }, shifts).r),
		).toBe('refused:conflicting-attribute');
		expect(
			status(run({ type: 'moveResource', resource: 'c', parent: 'a', index: 0 }, shifts).r),
		).toBe('edit');
	});

	it('refuses inheriting itself as manager (manager_is_self)', () => {
		const m = PLAN.replace('  efficiency 1.0\n', '  efficiency 1.0\n  managers cid\n');
		expect(
			status(run({ type: 'moveResource', resource: 'cid', parent: 'team', index: 0 }, m).r),
		).toBe('refused:conflicting-attribute');
	});

	it('refuses moving into a file with another resourceprefix', () => {
		const files = {
			'plan.tjp':
				'project p "P" 2026-01-05 +1m\nresource g "G" {\n  resource a "A"\n}\nresource h "H"\n' +
				'include "x.tji" { resourceprefix g }\n',
			'x.tji': 'resource k "K"\n',
		};
		expect(
			status(run({ type: 'moveResource', resource: 'h', parent: 'g', index: 2 }, files).r),
		).toBe('refused:unsupported-form');
	});

	it('the wrapper builds the intent', () => {
		const s = setup(PLAN);
		expect(moveResource(s.snap, s.index, 'bob', 'team', 1).status).toBe('noop');
	});
});

describe('renameResource', () => {
	it('rewrites the name string in its quote style', () => {
		expect(after({ type: 'renameResource', resource: 'ann', name: 'Ann "A"' })).toContain(
			'resource ann "Ann \\"A\\""',
		);
		const single = 'project p "P" 2026-01-05 +1m\nresource a \'A\'\n';
		expect(after({ type: 'renameResource', resource: 'a', name: "It's" }, single)).toContain(
			"resource a 'It\\'s'",
		);
	});

	it('refuses unsafe text and keeps the same name', () => {
		const s = setup(PLAN);
		expect(renameResource(s.snap, s.index, 'ann', 'Ann').status).toBe('noop');
		expect(renameResource(s.snap, s.index, 'ann', '$(HOME)')).toMatchObject({
			reason: 'unsafe-text',
		});
	});
});
