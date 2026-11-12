// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { createFile } from '../document';
import type { AttrFact, BodyItem, DeclFact, ProjectFact } from './facts';
import { scanFile } from './scan';

const scan = (text: string) => scanFile(createFile('plan.tjp', text));
const slice = (text: string, r: { from: number; to: number } | null | undefined) =>
	r ? text.slice(r.from, r.to) : null;

describe('scanFile', () => {
	const text = [
		'project p "P" 2026-01-05 +2m {',
		'  timezone "Europe/Berlin"',
		'  scenario plan "Plan" { scenario late "Late" }',
		'  extend resource { number Cost "Cost" { scenariospecific } }',
		'}',
		'# about a',
		'# more',
		'task a "A" {',
		'  delayed:effort 3d',
		'  depends !b { gaplength 1d }, x.y',
		'  ${m}',
		'  booking r 2026-01-05 +1h',
		'}',
		'macro m [ note "x ${y}" ]',
		'',
	].join('\n');
	const facts = scan(text);
	const items = facts.items;

	it('reads the project header and its body', () => {
		const p = items[0] as ProjectFact;
		expect(p.t).toBe('project');
		expect([p.id, p.name, p.intervalText]).toEqual(['p', 'P', '2026-01-05 +2m']);
		expect(p.body.map((b) => b.t)).toEqual(['attr', 'scenario', 'extend']);
		const sc = p.body[1];
		expect(sc?.t === 'scenario' && [sc.id, sc.children.map((c) => c.id)]).toEqual([
			'plan',
			['late'],
		]);
		const ex = p.body[2];
		expect(ex?.t === 'extend' && ex.attrs.map((a) => [a.type, a.id, a.scenarioSpecific])).toEqual([
			['number', 'Cost', true],
		]);
	});

	it('reads declarations with header, id, name, body and leading comments', () => {
		const a = items[1] as DeclFact;
		expect([a.kind, a.localId, a.name, a.line, a.idForm]).toEqual(['task', 'a', 'A', 8, 'literal']);
		expect(slice(text, a.site.header)).toBe('task a "A"');
		expect(slice(text, a.site.leadingComments)).toBe('# about a\n# more');
		expect(facts.headerLines.get('task:8')).toBe(1);
	});

	it('reads attributes with scenario, value and list items', () => {
		const a = items[1] as DeclFact;
		const kinds = a.body.map((b: BodyItem) => b.t);
		expect(kinds).toEqual(['attr', 'attr', 'macroCall', 'attr']);
		const effort = a.body[0] as AttrFact;
		expect([effort.site.keyword, effort.site.scenario, slice(text, effort.site.value)]).toEqual([
			'effort',
			'delayed',
			'3d',
		]);
		expect(effort.site.parsed?.kind).toBe('duration');
		const deps = a.body[1] as AttrFact;
		expect(deps.items.map((i) => [i.written, i.up, i.path, slice(text, i.body)])).toEqual([
			['!b', 1, 'b', '{ gaplength 1d }'],
			['x.y', 0, 'x.y', null],
		]);
		const booking = a.body[3] as AttrFact;
		expect(booking.site.textOnly?.reason).toBe('opaque');
		expect(booking.site.parsed).toBeNull();
	});

	it('reads macro definitions', () => {
		const m = items[2];
		expect(m?.t === 'macro' && [m.name, m.text, m.nestedCalls, m.words.has('note')]).toEqual([
			'm',
			' note "x ${y}" ',
			true,
			true,
		]);
	});

	it('keeps outermost opaque and macro-body ranges for mentions', () => {
		expect(facts.opaque.map((o) => [o.reason, slice(text, o.at)])).toEqual([
			['opaque', 'scenario plan "Plan" { scenario late "Late" }'],
			['opaque', 'extend resource { number Cost "Cost" { scenariospecific } }'],
			['opaque', '${m}'],
			['opaque', 'booking r 2026-01-05 +1h'],
			['macro-body', '[ note "x ${y}" ]'],
		]);
	});

	it('leaves values of text-only statements unparsed', () => {
		const t = 'task a "A" {\n  effort ${len}\n}\n';
		const a = scan(t).items[0] as DeclFact;
		const effort = a.body[0] as AttrFact;
		expect(effort.site.textOnly?.reason).toBe('macro-call');
		expect(effort.site.parsed).toBeNull();
	});

	it('treats invalid loose values as untyped (15.5)', () => {
		const t = 'task a "A" {\n  scheduling sometimes\n}\n';
		const a = scan(t).items[0] as DeclFact;
		expect((a.body[0] as AttrFact).site.parsed).toBeNull();
	});

	it('a copy with another text-only reason still parses the value once', () => {
		const t = 'task a "A" {\n  effort 2d\n}\n';
		const effort = (scan(t).items[0] as DeclFact).body[0] as AttrFact;
		const copy = effort.site.withTextOnly({
			reason: 'macro-id',
			at: { file: 'plan.tjp', from: 0, to: t.length },
			within: null,
		});
		expect(copy.parsed?.kind).toBe('duration');
		expect(copy.parsed).toBe(effort.site.parsed);
		expect(copy.textOnly?.reason).toBe('macro-id');
	});
});
