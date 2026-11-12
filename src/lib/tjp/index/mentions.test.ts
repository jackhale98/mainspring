// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { buildIndex, mentionPattern } from './index';
import { inline } from './testing';

describe('mentionPattern', () => {
	const hits = (kind: 'task' | 'resource', id: string, s: string) =>
		[...s.matchAll(mentionPattern(kind, id))].map((m) => m[0]);

	it('matches the full id, or ! or . with the local id, at word ends', () => {
		expect(hits('task', 'a.b', 'x a.b !b c.b ab.b bb b2 a.bc')).toEqual(['a.b', '!b', '.b', '.b']);
		expect(hits('resource', 'r', 'r rr !r x.r r1 (r)')).toEqual(['r', '!r', '.r', 'r']);
	});
});

describe('mentions', () => {
	it('finds ids in macro bodies, opaque statements and include bodies', () => {
		const text =
			'project p "P" 2026-01-05 +2m\nmacro dep [ depends !b ]\nresource r "R"\ntask a "A" {\n  task b "B"\n  booking r 2026-01-05 +1h\n}\ninclude "x.tji" { taskprefix a.b }\n';
		const idx = buildIndex(inline({ 'plan.tjp': text, 'x.tji': '' }).snapshot(), undefined, {
			cache: null,
		});
		const show = (kind: 'task' | 'resource', id: string) =>
			idx.mentions(kind, id).map((m) => [m.reason, text.slice(m.at.from, m.at.to)]);
		expect(show('task', 'a.b')).toEqual([
			['macro-body', '!b'],
			['opaque', 'a.b'],
		]);
		expect(show('resource', 'r')).toEqual([['opaque', 'r']]);
		// `taskprefix a.b` names a child of `a`, so it mentions `a` too (conservative).
		expect(show('task', 'a')).toEqual([['opaque', 'a']]);
		expect(show('task', 'x')).toEqual([]);
	});
});
