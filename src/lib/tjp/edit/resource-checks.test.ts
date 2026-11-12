// SPDX-License-Identifier: GPL-2.0-or-later
// Conditions under which a resource cannot take a new child (resource-checks.ts), through
// `checkNewParent` and the `addResource` / `moveResource` intents. Each refused case is an error
// in TaskJuggler 3.8.4 (checked natively or in the wasm engine).
import { describe, expect, it } from 'vitest';
import { applyIntent } from './apply';
import { checkNewParent } from './resource-checks';
import { setup } from './testing';
import type { EditIntent, EditResult } from './types';

const H = 'project p "P" 2026-01-05 - 2026-03-27 {\n  now 2026-02-02\n}\n';
const S1 = 'shift s1 "S1" { workinghours mon - fri 9:00 - 13:00 }\n';
const TAIL = 'resource b "B"\ntask t "T" { effort 3d allocate b }\n';

const status = (r: EditResult): string =>
	r.status === 'edit' ? 'edit' : `${r.status}:${r.reason}`;

function check(text: string, parent: string | null, ids: readonly string[] = []) {
	const s = setup(text);
	const p = parent === null ? null : (s.index.resources.get(parent) ?? null);
	const r = checkNewParent(s.ctx, p, ids);
	return r ? r.at.map((x) => s.file().text.sliceString(x.from, x.to)) : null;
}

function both(text: string, parent: string, mover = 'b'): string[] {
	const s = setup(text);
	const add: EditIntent = { type: 'addResource', parent, index: 0, name: 'Kid' };
	const move: EditIntent = { type: 'moveResource', resource: mover, parent, index: 0 };
	return [add, move].map((i) => status(applyIntent(s.snap, s.index, i)));
}

describe('checkNewParent', () => {
	it('lets a plain leaf or any group take a child, and a root needs no check', () => {
		const plan = H + 'resource a "A"\nresource g "G" {\n  resource k "K"\n}\n' + TAIL;
		expect(check(plan, 'a')).toBeNull();
		expect(check(plan, 'g')).toBeNull();
		expect(check(plan, null)).toBeNull();
	});

	it('keeps a manager a leaf (manager_is_group)', () => {
		const plan = H + 'resource a "A"\nresource c "C" { managers a }\n' + TAIL;
		expect(check(plan, 'a')).toEqual(['a']);
	});

	it('keeps a booked leaf a leaf (booking_group)', () => {
		const plan = H + 'resource a "A" {\n  booking t 2026-01-05-09:00 +4h\n}\n' + TAIL;
		expect(check(plan, 'a')).toEqual(['booking t 2026-01-05-09:00 +4h']);
	});

	it('keeps a leaf named in opaque text a leaf (leaf_resource_id_expected)', () => {
		const plan =
			H +
			'resource a "A"\n' +
			TAIL.replace('allocate b', 'allocate b\n  limits { dailymax 4h resources a }');
		expect(check(plan, 'a')).toEqual(['a']);
	});

	it('refuses a leaf whose supplement assigns shifts (container_attribute, case addshift)', () => {
		const plan = H + S1 + 'resource a "A"\nsupplement resource a { shifts s1 }\n' + TAIL;
		expect(check(plan, 'a')).toEqual(['shifts s1']);
		expect(both(plan, 'a')).toEqual([
			'refused:conflicting-attribute',
			'refused:conflicting-attribute',
		]);
		// The deprecated keyword too.
		expect(check(plan.replace('{ shifts s1 }', '{ shift s1 }'), 'a')).toEqual(['shift s1']);
	});

	it('allows shifts in the leaf declaration body: the child goes after them', () => {
		const plan = H + S1 + 'resource a "A" {\n  shifts s1\n}\n' + TAIL;
		expect(check(plan, 'a')).toBeNull();
		expect(both(plan, 'a')).toEqual(['edit', 'edit']);
	});

	it('refuses a subtree with shifts under a chain that assigns shifts (shift_assignment_overlap)', () => {
		const plan =
			H + S1 + 'resource g "G" {\n  shifts s1\n  resource k "K"\n}\nresource b "B" { shifts s1 }\n';
		expect(check(plan, 'g', ['b'])).toEqual(['shifts s1']);
		expect(check(plan, 'g', ['k'])).toBeNull();
	});

	it('refuses a subtree holding a manager the chain names (manager_is_self)', () => {
		const plan = H + 'resource g "G" {\n  managers b\n  resource k "K"\n}\n' + TAIL;
		expect(check(plan, 'g', ['b'])).toEqual(['b']);
		expect(check(plan, 'k', ['b'])).toEqual(['b']);
		expect(check(plan, null, ['b'])).toBeNull();
	});
});
