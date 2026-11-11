// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	isId,
	isIdPath,
	parseId,
	parseIdList,
	parseTaskRef,
	printIdList,
	printTaskRef,
	refFor,
	resolveTaskRef,
	slugId,
} from './ids';

describe('ids', () => {
	it('uses ASCII word characters', () => {
		expect(isId('_a1')).toBe(true);
		expect(isId('1a')).toBe(false);
		expect(isId('café')).toBe(false);
		expect(isIdPath('a.b_2.c')).toBe(true);
		expect(isIdPath('a..b')).toBe(false);
		expect(parseId('a.b')).toMatchObject({ ok: false, error: { code: 'unexpected-token' } });
	});
});

describe('task references', () => {
	it('reads relative, plain and absolute references', () => {
		expect(parseTaskRef('!sibling')).toMatchObject({ ok: true, value: { up: 1, path: 'sibling' } });
		expect(parseTaskRef('!!parent.child')).toMatchObject({
			ok: true,
			value: { up: 2, path: 'parent.child' },
		});
		expect(parseTaskRef('! ! x')).toMatchObject({ ok: true, value: { up: 2, path: 'x' } });
		expect(parseTaskRef('a.b.c')).toMatchObject({ ok: true, value: { up: 0, path: 'a.b.c' } });
		expect(parseTaskRef('!=x')).toMatchObject({ ok: false, error: { code: 'unexpected-token' } });
		expect(parseTaskRef('!')).toMatchObject({ ok: false, error: { code: 'unexpected-end' } });
	});

	it('resolves like rule_taskDepId', () => {
		expect(resolveTaskRef({ up: 1, path: 'a' }, 'p.x')).toEqual({ ok: true, value: 'p.a' });
		expect(resolveTaskRef({ up: 2, path: 'a' }, 'p.x')).toEqual({ ok: true, value: 'a' });
		expect(resolveTaskRef({ up: 2, path: 'q.a' }, 'r.p.x')).toEqual({ ok: true, value: 'r.q.a' });
		expect(resolveTaskRef({ up: 1, path: 'b' }, 'a')).toEqual({ ok: true, value: 'b' });
		expect(resolveTaskRef({ up: 3, path: 'a' }, 'p.x')).toMatchObject({
			ok: false,
			error: { tj: 'too_many_bangs' },
		});
		expect(resolveTaskRef({ up: 1, path: 'a' }, null)).toMatchObject({
			ok: false,
			error: { tj: 'too_many_bangs' },
		});
		expect(resolveTaskRef({ up: 0, path: 'x.y' }, 'p.q')).toEqual({ ok: true, value: 'x.y' });
	});

	it('writes !id for siblings and absolute ids otherwise', () => {
		expect(refFor('p.x', 'p.y')).toEqual({ up: 1, path: 'y' });
		expect(refFor('x', 'y')).toEqual({ up: 1, path: 'y' });
		expect(refFor('p.x', 'q.y')).toEqual({ up: 0, path: 'q.y' });
		expect(refFor('p.x.z', 'p.y')).toEqual({ up: 0, path: 'p.y' });
		expect(printTaskRef(refFor('p.x', 'p.y'))).toEqual({ ok: true, value: '!y' });
		expect(printTaskRef({ up: 0, path: 'a b' }).ok).toBe(false);
	});

	it('always resolves refFor back to its target', () => {
		for (const [from, to] of [
			['a', 'b'],
			['p.x', 'p.y'],
			['p.x', 'q'],
			['p.q.x', 'p.y.z'],
		] as const) {
			expect(resolveTaskRef(refFor(from, to), from)).toEqual({ ok: true, value: to });
		}
	});
});

describe('id lists', () => {
	it('reads comma-separated ids with their spans', () => {
		const r = parseIdList('ana, bob ,cy', 10);
		expect(r).toMatchObject({ ok: true, value: ['ana', 'bob', 'cy'] });
		expect(r.ok && r.items).toEqual([
			{ from: 10, to: 13 },
			{ from: 15, to: 18 },
			{ from: 20, to: 22 },
		]);
	});

	it('refuses dotted ids unless allowed, and dangling commas', () => {
		expect(parseIdList('a.b')).toMatchObject({ ok: false, error: { code: 'not-an-id' } });
		expect(parseIdList('a.b', 0, { dotted: true })).toMatchObject({ ok: true, value: ['a.b'] });
		expect(parseIdList('a,')).toMatchObject({ ok: false, error: { code: 'unexpected-end' } });
		expect(parseIdList('a b')).toMatchObject({ ok: false, error: { code: 'trailing-text' } });
	});

	it('prints canonically', () => {
		expect(printIdList(['a', 'b'])).toEqual({ ok: true, value: 'a, b' });
		expect(printIdList([]).ok).toBe(false);
		expect(printIdList(['a.b']).ok).toBe(false);
	});
});

describe('slugId', () => {
	it('makes ASCII ids from names', () => {
		expect(slugId('Write the Docs!')).toBe('write_the_docs');
		expect(slugId('Café crème')).toBe('cafe_creme');
		expect(slugId('2nd phase')).toBe('_2nd_phase');
		expect(slugId('***')).toBe('task');
		const taken = new Set(['docs', 'docs_2']);
		expect(slugId('Docs', (id) => taken.has(id))).toBe('docs_3');
		expect(isId(slugId('日本語'))).toBe(true);
	});
});
