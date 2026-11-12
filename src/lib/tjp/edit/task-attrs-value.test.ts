// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { checkAttrValue, checkIdList, parseAttrValue, readBefore } from './task-attrs-value';
import { setup, span } from './testing';
import { isRefused } from './types';

const SRC =
	'project p "P" 2026-01-05 +2m\nflags hot\nresource r "R"\n' +
	'task a "A" {\n  effort 1d\n}\nflags late\nresource q "Q"\n';

describe('task attribute values', () => {
	const s = setup(SRC);
	const f = s.file();
	const at = { file: f.path, ...span(f, '1d') };

	it('parses TaskJuggler text by the keyword kind', () => {
		expect(parseAttrValue('effort', '3d', [at])).toMatchObject({ kind: 'duration' });
		expect(parseAttrValue('note', '"x"', [at])).toEqual({ kind: 'string', value: 'x' });
		for (const [kw, v] of [
			['effort', 'x'],
			['effort', true],
			['note', 'x'],
			['milestone', 'x'],
		] as const) {
			expect(parseAttrValue(kw, v, [at])).toMatchObject({ reason: 'invalid-value', at: [at] });
		}
	});

	it('checks values against the context at a position', () => {
		const ok = parseAttrValue('start', '2026-01-10', [at]);
		const out = parseAttrValue('start', '2030-01-10', [at]);
		const zero = parseAttrValue('effort', '0d', [at]);
		if (isRefused(ok) || isRefused(out) || isRefused(zero)) throw new Error('parse');
		expect(checkAttrValue(s.ctx, 'start', ok, at, [at])).toBeNull();
		expect(checkAttrValue(s.ctx, 'start', out, at, [at])).toMatchObject({
			reason: 'invalid-value',
		});
		expect(checkAttrValue(s.ctx, 'effort', zero, at, [at])).toMatchObject({
			reason: 'invalid-value',
		});
	});

	it('checks id lists in reading order', () => {
		const pos = { file: f.path, ...span(f, 'effort') };
		expect(checkIdList(s.ctx, 'flags', ['hot', 'hot'], pos, [pos])).toEqual(['hot']);
		expect(checkIdList(s.ctx, 'flags', ['late'], pos, [pos])).toMatchObject({
			reason: 'undeclared-flag',
		});
		expect(checkIdList(s.ctx, 'responsible', 'r', pos, [pos])).toEqual(['r']);
		expect(checkIdList(s.ctx, 'responsible', ['q'], pos, [pos])).toMatchObject({
			reason: 'invalid-value',
		});
		expect(checkIdList(s.ctx, 'responsible', ['no way'], pos, [pos])).toMatchObject({
			reason: 'invalid-value',
		});
		const flag = s.index.flags.get('late');
		expect(flag && readBefore(s.ctx, pos, flag)).toBe(true);
	});
});
