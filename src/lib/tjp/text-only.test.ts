// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { readTjp } from '../../../tests/grammar/corpus';
import { createFile, parseTjp } from './document';
import {
	TEXT_ONLY_PRIORITY,
	blocks,
	findTextOnly,
	textOnlyOf,
	textOnlyRanges,
	type TextOnly,
} from './text-only';

/** Each range as `reason:text`, in order. */
function show(text: string, opts: Parameters<typeof textOnlyRanges>[3] = {}): string[] {
	return textOnlyRanges('p.tjp', parseTjp(text), text, opts).map(
		(t) => `${t.reason}:${text.slice(t.at.from, t.at.to)}`,
	);
}

describe('text-only rules (5.4)', () => {
	it('X1: macro bodies', () => {
		expect(show('macro m [ task x "y" ]\n')).toEqual(['macro-body:[ task x "y" ]']);
	});

	it('X2 and X3: macro calls, words and env refs, and their statements', () => {
		const text = 'task a "A" {\n  effort ${len}\n  note "$(USER)"\n  priority x${p}y\n}\n';
		expect(show(text)).toEqual([
			'macro-call:effort ${len}',
			'macro-call:${len}',
			'macro-call:note "$(USER)"',
			'env-var:"$(USER)"',
			'macro-call:priority x${p}y',
			'macro-call:x${p}y',
		]);
	});

	it('X2: templated strings choose macro-call or env-var by content', () => {
		const text = 'task a "${n} and $(HOME)" {\n}\ntask b "$(HOME)" {\n}\n';
		expect(show(text)).toEqual(['macro-call:"${n} and $(HOME)"', 'env-var:"$(HOME)"']);
	});

	it('X3: project header up to its body, statements with macro bodies wholly', () => {
		const text = 'project p "P" ${start} +1m {\n  now 2026-01-05\n}\ninclude "$(D)/a.tji"\n';
		expect(show(text)).toEqual([
			'macro-call:project p "P" ${start} +1m ',
			'macro-call:${start}',
			'macro-call:include "$(D)/a.tji"',
			'env-var:"$(D)/a.tji"',
		]);
	});

	it('X3: nested statements are judged on their own', () => {
		const text = 'task a "A" {\n  depends b { gaplength ${g} }\n}\n';
		expect(show(text)).toEqual(['macro-call:gaplength ${g}', 'macro-call:${g}']);
		const whole = 'task a "A" {\n  depends ${b} { gaplength 1d }\n}\n';
		expect(show(whole)).toEqual(['macro-call:depends ${b} { gaplength 1d }', 'macro-call:${b}']);
	});

	it('X4: macro ids and missing ids, narrowed to id and name once resolved', () => {
		const text = 'task ${t} "${n}" {\n  effort 1d\n}\nresource "Auto"\n';
		expect(show(text)).toEqual([
			'macro-id:task ${t} "${n}" {\n  effort 1d\n}',
			'macro-call:${t}',
			'macro-call:"${n}"',
			'auto-id:resource "Auto"',
		]);
		expect(show(text, { resolved: () => true })).toEqual([
			'macro-id:${t}',
			'macro-call:${t}',
			'macro-id:"${n}"',
			'macro-call:"${n}"',
			'auto-id:"Auto"',
		]);
		expect(show('task a "${n}" {\n}\n')).toEqual(['macro-call:"${n}"']);
	});

	it('X6: syntax errors, widened to the statement when empty', () => {
		const out = show('task a "A" {\n  effort 2d @\n}\n');
		expect(out.some((s) => s.startsWith('syntax-error:'))).toBe(true);
		for (const r of textOnlyRanges('p.tjp', parseTjp('task a'), 'task a')) {
			expect(r.at.to).toBeGreaterThan(r.at.from);
		}
	});

	it('X7: opaque statements, extension attributes and statement-level macros', () => {
		const text = 'task a "A" {\n  limits { dailymax 4h }\n  Phone "1"\n}\n';
		expect(show(text)).toEqual([
			'opaque:limits { dailymax 4h }',
			'opaque:dailymax 4h',
			'opaque:Phone "1"',
		]);
		expect(show('task a "A" {\n  ${alloc}\n}\n')).toEqual([
			'opaque:${alloc}',
			'macro-call:${alloc}',
			'macro-call:${alloc}',
		]);
	});

	it('marks nothing in plain MVP text', () => {
		expect(
			show(readTjp('engine/golden/plans/poc-sample/plan.tjp')).filter(
				(s) => !s.startsWith('opaque:'),
			),
		).toEqual([]);
	});

	it('finds every macro form in the macro fixtures', () => {
		const text = readTjp('tests/fixtures/tjp/macro-ids/plan.tjp');
		const reasons = new Set(textOnlyRanges('p.tjp', parseTjp(text), text).map((t) => t.reason));
		expect([...reasons].sort()).toEqual(['macro-body', 'macro-call', 'macro-id']);
	});

	it('caches per file', () => {
		const f = createFile('a.tjp', 'macro m [x]\n');
		expect(textOnlyOf(f)).toBe(textOnlyOf(f));
		expect(textOnlyOf(f)[0]?.at.file).toBe('a.tjp');
	});
});

describe('blocks and findTextOnly', () => {
	const r = { from: 10, to: 20 };

	it('blocks targets inside or crossing, not strictly containing', () => {
		expect(blocks(r, 12, 15)).toBe(true);
		expect(blocks(r, 10, 20)).toBe(true);
		expect(blocks(r, 5, 15)).toBe(true);
		expect(blocks(r, 15, 25)).toBe(true);
		expect(blocks(r, 5, 25)).toBe(false);
		expect(blocks(r, 10, 25)).toBe(false);
		expect(blocks(r, 0, 10)).toBe(false);
		expect(blocks(r, 20, 30)).toBe(false);
	});

	it('blocks insertion points strictly inside', () => {
		expect(blocks(r, 15, 15)).toBe(true);
		expect(blocks(r, 10, 10)).toBe(false);
		expect(blocks(r, 20, 20)).toBe(false);
	});

	it('reports the highest-priority reason', () => {
		const at = (reason: TextOnly['reason'], from: number, to: number): TextOnly => ({
			reason,
			at: { file: 'a.tjp', from, to },
		});
		const list = [at('opaque', 0, 50), at('macro-call', 10, 20), at('syntax-error', 30, 40)];
		expect(findTextOnly(list, 'a.tjp', 12, 14)?.reason).toBe('macro-call');
		expect(findTextOnly(list, 'a.tjp', 32, 33)?.reason).toBe('syntax-error');
		expect(findTextOnly(list, 'a.tjp', 45, 46)?.reason).toBe('opaque');
		expect(findTextOnly(list, 'a.tjp', 60, 60)).toBeNull();
		expect(findTextOnly(list, 'b.tjp', 12, 14)).toBeNull();
		expect(new Set(TEXT_ONLY_PRIORITY).size).toBe(8);
	});

	it('lets an edit delete a block that holds a macro call, not rewrite the call', () => {
		const text = 'task a "A" {\n  effort ${len}\n}\n';
		const list = textOnlyRanges('p.tjp', parseTjp(text), text);
		expect(findTextOnly(list, 'p.tjp', 0, text.length - 1)).toBeNull();
		const v = text.indexOf('${len}');
		expect(findTextOnly(list, 'p.tjp', v, v + 6)?.reason).toBe('macro-call');
		const stmt = text.indexOf('effort');
		expect(findTextOnly(list, 'p.tjp', stmt, v + 6)?.reason).toBe('macro-call');
	});
});
