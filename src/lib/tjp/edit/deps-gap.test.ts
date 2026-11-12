// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { applyIntent } from './apply';
import { setDependsGap } from './link-intents';
import { setup, textsAfter } from './testing';
import type { EditIntent, EditResult } from './types';

const HEAD = 'project p "P" 2026-01-05 +2m\nresource r "R"\n';
type Gap = Extract<EditIntent, { type: 'setDependsGap' }>['gap'];
const gap = (task: string, target: string, g: Gap): EditIntent => ({
	type: 'setDependsGap',
	task,
	target,
	gap: g,
});

function run(plan: string, intent: EditIntent): EditResult {
	const s = setup(plan);
	return applyIntent(s.snap, s.index, intent);
}

function after(plan: string, intent: EditIntent): string {
	const s = setup(plan);
	return textsAfter(s.snap, applyIntent(s.snap, s.index, intent))['plan.tjp'] ?? '';
}

const A = HEAD + 'task a "A" { effort 1d allocate r }\n';

describe('setDependsGap', () => {
	it('creates a body after the reference', () => {
		const plan = A + 'task b "B" {\n  depends !a\n}\n';
		expect(after(plan, gap('b', 'a', { kind: 'gapduration', value: '2d' }))).toBe(
			A + 'task b "B" {\n  depends !a { gapduration 2d }\n}\n',
		);
	});

	it('adds to a one-line body before the brace, and to a multi-line body on its own line', () => {
		const one = A + 'task b "B" {\n  depends !a { onstart }\n}\n';
		expect(after(one, gap('b', 'a', { kind: 'gaplength', value: '1d' }))).toBe(
			A + 'task b "B" {\n  depends !a { onstart gaplength 1d }\n}\n',
		);
		const multi = A + 'task b "B" {\n\tdepends !a {\n\t\tonstart\n\t}\n}\n';
		expect(after(multi, gap('b', 'a', { kind: 'gaplength', value: '1d' }))).toBe(
			A + 'task b "B" {\n\tdepends !a {\n\t\tonstart\n\t\tgaplength 1d\n\t}\n}\n',
		);
		const crlf =
			'project p "P" 2026-01-05 +2m\r\ntask a "A"\r\ntask b "B" {\r\n  depends !a {\r\n    onend\r\n  }\r\n}\r\n';
		expect(after(crlf, gap('b', 'a', { kind: 'gapduration', value: '4h' }))).toBe(
			crlf.replace('    onend\r\n', '    onend\r\n    gapduration 4h\r\n'),
		);
	});

	it('rewrites the value, keeps a spelling that means it, and replaces the other kind', () => {
		const plan = A + 'task b "B" {\n  depends !a { gapduration 2d }\n}\n';
		expect(after(plan, gap('b', 'a', { kind: 'gapduration', value: '3d' }))).toBe(
			A + 'task b "B" {\n  depends !a { gapduration 3d }\n}\n',
		);
		expect(run(plan, gap('b', 'a', { kind: 'gapduration', value: ' 2d' }))).toEqual({
			status: 'noop',
			reason: 'already-set',
		});
		expect(after(plan, gap('b', 'a', { kind: 'gaplength', value: '1w' }))).toBe(
			A + 'task b "B" {\n  depends !a { gaplength 1w }\n}\n',
		);
		const both = A + 'task b "B" {\n  depends !a { gaplength 1d gapduration 2d }\n}\n';
		expect(after(both, gap('b', 'a', { kind: 'gaplength', value: '2d' }))).toBe(
			A + 'task b "B" {\n  depends !a { gaplength 2d }\n}\n',
		);
	});

	it('clears the gap, dropping a body left empty', () => {
		const plan = A + 'task b "B" {\n  depends !a { gapduration 2d }, x\n}\ntask x "X"\n';
		expect(after(plan, gap('b', 'a', null))).toBe(
			A + 'task b "B" {\n  depends !a, x\n}\ntask x "X"\n',
		);
		const keep = A + 'task b "B" {\n  depends !a {\n    gapduration 2d\n    onstart\n  }\n}\n';
		expect(after(keep, gap('b', 'a', null))).toBe(
			A + 'task b "B" {\n  depends !a {\n    onstart\n  }\n}\n',
		);
		const commented = A + 'task b "B" {\n  depends !a { gapduration 2d # why\n  }\n}\n';
		expect(after(commented, gap('b', 'a', null))).toBe(
			A + 'task b "B" {\n  depends !a { # why\n  }\n}\n',
		);
		expect(run(A + 'task b "B" { depends !a }\n', gap('b', 'a', null))).toEqual({
			status: 'noop',
			reason: 'not-present',
		});
	});

	it('sets the gap on a precedes item and on every unprefixed item of the link', () => {
		const prec = HEAD + 'task a "A" { precedes !b }\ntask b "B"\n';
		expect(after(prec, gap('b', 'a', { kind: 'gaplength', value: '2d' }))).toBe(
			HEAD + 'task a "A" { precedes !b { gaplength 2d } }\ntask b "B"\n',
		);
		const both = HEAD + 'task a "A" { precedes !b }\ntask b "B" { depends !a }\n';
		const out = after(both, gap('b', 'a', { kind: 'gaplength', value: '2d' }));
		expect(out.match(/gaplength 2d/g)).toHaveLength(2);
	});

	it('validates the duration as TaskJuggler does', () => {
		const plan = A + 'task b "B" { depends !a }\n';
		for (const value of ['0d', '7', 'x', '2d junk']) {
			expect(run(plan, gap('b', 'a', { kind: 'gapduration', value }))).toMatchObject({
				status: 'refused',
				reason: 'invalid-value',
			});
		}
		// Not a multiple of the timing resolution (1 hour here).
		const coarse = plan.replace('+2m', '+2m {\n  timingresolution 60min\n}');
		expect(run(coarse, gap('b', 'a', { kind: 'gapduration', value: '30min' }))).toMatchObject({
			reason: 'invalid-value',
		});
		expect(run(plan, gap('b', 'a', { kind: 'gaplength', value: '0h' }))).toMatchObject({
			reason: 'invalid-value',
		});
	});

	it('refuses a missing link and unknown tasks', () => {
		const s = setup(A + 'task b "B"\n');
		expect(
			setDependsGap(s.snap, s.index, 'b', 'a', { kind: 'gaplength', value: '1d' }),
		).toMatchObject({
			reason: 'unknown-target',
		});
		expect(setDependsGap(s.snap, s.index, 'b', 'zz', null)).toMatchObject({
			reason: 'unknown-target',
		});
	});

	it('refuses a gap next to a macro in the body', () => {
		const plan = A + 'macro g [gaplength 1d]\ntask b "B" {\n  depends !a { ${g} }\n}\n';
		expect(run(plan, gap('b', 'a', { kind: 'gapduration', value: '1d' }))).toMatchObject({
			status: 'refused',
		});
	});
});
