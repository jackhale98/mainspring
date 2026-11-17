// SPDX-License-Identifier: GPL-2.0-or-later
// The person edits (person-edit.ts, W7 and W8): each intent with its label, and the exact patch the
// edit API writes for it, so a field's commit is a minimal change of the text and nothing else.
import { describe, expect, it } from 'vitest';
import { applyIntent } from '../tjp/edit/apply';
import { setup, textsAfter } from '../tjp/edit/testing';
import { at, plan } from '../schedule/testing';
import { booking, resourceResult, withPeople } from '../workload/testing';
import {
	addEdit,
	deleteEdit,
	efficiencyEdit,
	emailEdit,
	managersEdit,
	numberText,
	parseAmount,
	rateEdit,
	renameEdit,
} from './person-edit';
import { personDetails } from './person';

const TEXT = `project p "P" 2026-03-02 +8w
resource team "Team" {
  managers boss
  resource a "Ann" {
    efficiency 0.8
    managers lead
  }
  resource b "Bob"
}
resource boss "Boss"
resource lead "Lead"
resource spare "Spare"
task t1 "Build" { effort 2d  allocate a }
`;
const s = setup(TEXT);
const result = withPeople(
	plan([['t1', { start: at(0, 9), end: at(1, 17) }]]),
	[resourceResult('a')],
	[booking('a', 't1', [[at(0, 9), at(0, 17)]])],
);
const detail = (id: string) => {
	const d = personDetails(s.index, result, id);
	if (!d) throw new Error(`no ${id}`);
	return d;
};
const after = (e: { intent: Parameters<typeof applyIntent>[2] }): string =>
	textsAfter(s.snap, applyIntent(s.snap, s.index, e.intent))['plan.tjp'] as string;

describe('numbers', () => {
	it('prints at most two decimals and parses what TaskJuggler reads', () => {
		expect(numberText(0.85000000001)).toBe('0.85');
		expect(numberText(1)).toBe('1');
		expect(numberText(0.1 + 0.2)).toBe('0.3');
		expect(parseAmount('0.5')).toBe(0.5);
		expect(parseAmount(' 62.5 ')).toBe(62.5);
		expect(parseAmount('-1')).toBeNull();
		expect(parseAmount('1,5')).toBeNull();
		expect(parseAmount('abc')).toBeNull();
		expect(parseAmount('')).toBeNull();
	});
});

describe('efficiency, rate and e-mail (W8)', () => {
	it('rewrites an own efficiency in place', () => {
		const e = efficiencyEdit(detail('a'), 0.85);
		expect(e.label.text).toBe('Efficiency of Ann: 0.85');
		expect(after(e)).toBe(TEXT.replace('efficiency 0.8\n', 'efficiency 0.85\n'));
	});

	it('inserts one that was not written', () => {
		const e = efficiencyEdit(detail('b'), 0.5);
		expect(after(e)).toBe(
			TEXT.replace('resource b "Bob"\n', 'resource b "Bob" {\n    efficiency 0.5\n  }\n'),
		);
	});

	it('inserts a rate, and removes it when emptied', () => {
		const set = rateEdit(detail('b'), '450');
		expect(set?.label.text).toBe('Rate of Bob: 450');
		expect(after(set!)).toContain('resource b "Bob" {\n    rate 450\n  }');
		expect(rateEdit(detail('a'), '')?.intent).toEqual({
			type: 'removeResourceAttr',
			resource: 'a',
			attr: 'rate',
		});
		expect(rateEdit(detail('a'), 'lots')).toBeNull();
		expect(rateEdit(detail('a'), '-5')).toBeNull();
	});

	it('writes the e-mail as a string, and clears it', () => {
		const e = emailEdit(detail('b'), 'bob@example.com');
		expect(after(e!)).toContain('email "bob@example.com"');
		expect(emailEdit(detail('b'), '  ')?.intent.type).toBe('removeResourceAttr');
		expect(emailEdit(detail('b'), 'a${b}')).toBeNull();
	});
});

describe('managers', () => {
	it('sends the whole list: what the group gives stays, the person’s own change', () => {
		const added = managersEdit(detail('a'), ['lead', 'spare'], {
			id: 'spare',
			name: 'Spare',
			added: true,
		});
		expect(added.intent).toEqual({
			type: 'setResourceAttr',
			resource: 'a',
			attr: 'managers',
			value: ['boss', 'lead', 'spare'],
		});
		expect(added.label.text).toBe('Spare now manages Ann');
		expect(after(added)).toContain('managers boss, lead, spare');
	});

	it('removes the statement when the last own manager goes', () => {
		const e = managersEdit(detail('a'), [], { id: 'lead', name: 'Lead', added: false });
		expect(e.intent).toEqual({ type: 'removeResourceAttr', resource: 'a', attr: 'managers' });
		expect(e.label.text).toBe('Lead no longer manages Ann');
		expect(after(e)).not.toContain('managers lead');
	});

	it('adds an own manager to a person who has none', () => {
		const e = managersEdit(detail('b'), ['spare'], { id: 'spare', name: 'Spare', added: true });
		expect(e.intent).toMatchObject({ type: 'setResourceAttr', value: ['boss', 'spare'] });
	});
});

describe('rename, delete and add (W7)', () => {
	it('renames by the name string only, so the id and every reference stay', () => {
		const e = renameEdit('a', 'Ann', 'Anna');
		expect(e.label.text).toBe('Ann renamed Anna');
		expect(after(e)).toBe(TEXT.replace('resource a "Ann"', 'resource a "Anna"'));
	});

	it('deletes with their allocations, as one edit', () => {
		const e = deleteEdit('b', 'Bob');
		expect(e.label.text).toBe('Deleted Bob');
		expect(after(e)).toBe(TEXT.replace('  resource b "Bob"\n', ''));
	});

	it('refuses to delete the only person an effort task is allocated to', () => {
		const r = applyIntent(s.snap, s.index, deleteEdit('a', 'Ann').intent);
		expect(r).toMatchObject({ status: 'refused', reason: 'conflicting-attribute' });
	});

	it('adds a person whose id follows the name typed first, in a group', () => {
		const e = addEdit('team', 2, 'Cy Twombly', 'person');
		expect(e.label.text).toBe('Added Cy Twombly');
		expect(after(e)).toContain('  resource b "Bob"\n  resource cy_twombly "Cy Twombly"\n}');
	});

	it('adds a group at the top level, labelled as a group', () => {
		const e = addEdit(null, 5, 'Crew', 'group');
		expect(e.label.text).toBe('Added group Crew');
		expect(after(e)).toContain('resource crew "Crew"');
	});
});
