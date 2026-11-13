// SPDX-License-Identifier: GPL-2.0-or-later
// The intents the inspector's fields make (edit.ts) and what the edit API writes for them, on the
// gantt-manipulation fixture: each field's intent applied to the real text gives the minimal patch.
import { describe, expect, it } from 'vitest';
import { analyseResult } from '../schedule/critical';
import { manipulation } from '../gantt/intents-testing';
import { resolveLinks } from '../gantt/links';
import { finishScenario } from '../schedule/finish';
import { applyIntent } from '../tjp/edit/apply';
import type { EditIntent } from '../tjp/edit/types';
import {
	dateEdit,
	declareFlagEdit,
	flagsEdit,
	gapEdit,
	milestoneEdit,
	noteEdit,
	numberEdit,
	projectEdit,
	responsibleEdit,
	schedulingEdit,
	sizeEdit,
} from './edit';
import { linksOfTask } from './links';
import { taskDetails } from './task';

const fx = manipulation();
const analysis = analyseResult(fx.result);
const d = (id: string) => {
	const t = taskDetails({ index: fx.index, result: fx.result, analysis }, id);
	if (!t) throw new Error(id);
	return t;
};
const file = 'plan.tjp';
/** The entry file after an intent; null when the edit API does not give an edit. */
function after(intent: EditIntent): string | null {
	const r = applyIntent(fx.snap, fx.index, intent, {});
	if (r.status !== 'edit') return null;
	const base = fx.snap.files.get(file)?.text;
	const cs = r.edit.changes[file];
	return base && cs ? cs.apply(base).toString() : null;
}
const before = fx.text(file);

describe('size', () => {
	it('rewrites the value; a new kind rewrites keyword and value together', () => {
		const same = sizeEdit(d('design.research'), 'effort', '5d');
		expect(same.label.text).toBe('Effort of Research: 3d to 5d');
		expect(after(same.intent)).toBe(before.replace('effort 3d', 'effort 5d'));
		const kind = sizeEdit(d('design.research'), 'length', '3d');
		expect(kind.label.text).toBe('Research is now Length instead of Effort');
		expect(after(kind.intent)).toBe(before.replace('effort 3d', 'length 3d'));
	});

	it('inserts a size into a task that has none', () => {
		const e = sizeEdit(d('spike'), 'effort', '2d');
		expect(e.label.text).toBe('Effort of Spike: 2d');
		expect(after(e.intent)).toContain('effort 2d');
	});
});

describe('dates, scheduling, numbers, notes', () => {
	it('sets a date, flags a new start as a constraint, and clears with an empty field', () => {
		const set = dateEdit(d('design.research'), 'start', '2026-03-03');
		expect(set.constraint).toBe(true);
		expect(set.label.text).toBe('Start of Research: 2026-03-03');
		expect(after(set.intent)).toContain('start 2026-03-03');
		const change = dateEdit(d('launch'), 'start', '2026-05-05');
		expect(change.constraint).toBeUndefined();
		expect(change.label.text).toBe('Start of Launch: 2026-05-04 to 2026-05-05');
		expect(after(change.intent)).toBe(before.replace('start 2026-05-04', 'start 2026-05-05'));
		const clear = dateEdit(d('launch'), 'start', '  ');
		expect(clear.intent).toMatchObject({ type: 'removeAttr', attr: 'start' });
	});

	it('writes scheduling, priority and complete', () => {
		expect(after(schedulingEdit(d('design.sketch'), 'alap').intent)).toContain('scheduling alap');
		expect(schedulingEdit(d('design.docs'), '').intent).toMatchObject({ type: 'removeAttr' });
		const p = numberEdit(d('design.sketch'), 'priority', 600);
		expect(p.label.text).toBe('Priority of Sketch: 600');
		expect(after(p.intent)).toContain('priority 600');
		const c = numberEdit(d('design.research'), 'complete', 60);
		expect(c.label.text).toBe('Progress of Research: 60%');
		expect(after(c.intent)).toBe(before.replace('complete 40', 'complete 60'));
	});

	it('writes a note as a string and clears it when empty', () => {
		const e = noteEdit(d('design.sketch'), 'Check the "mock" first');
		expect(e?.intent).toMatchObject({ type: 'setAttr', attr: 'note' });
		expect(after(e?.intent as EditIntent)).toContain('note "Check the \\"mock\\" first"');
		expect(noteEdit(d('design.sketch'), '')?.intent).toMatchObject({ type: 'removeAttr' });
	});

	it('turns milestone on and off', () => {
		const on = milestoneEdit(d('spike'), true);
		expect(on.label.text).toBe('Spike is now a milestone');
		expect(after(on.intent)).toContain('milestone');
		expect(milestoneEdit(d('design.gate'), false).label.text).toBe(
			'Design gate is no longer a milestone',
		);
	});
});

describe('lists', () => {
	it('sends the whole list, keeping what a parent gives', () => {
		const e = flagsEdit(d('design.sketch'), ['x'], 'x');
		expect(e.intent).toMatchObject({ type: 'setAttr', attr: 'flags', value: ['x'] });
		expect(e.label.text).toBe('Sketch flagged x');
		expect(declareFlagEdit('x')).toMatchObject({ intent: { type: 'declareFlag', flag: 'x' } });
	});

	it('sets and clears the responsible person', () => {
		const e = responsibleEdit(d('design.sketch'), 'dev2', 'Dev 2');
		expect(e.label.text).toBe('Dev 2 is responsible for Sketch');
		expect(after(e.intent)).toContain('responsible dev2');
		expect(responsibleEdit(d('launch'), null, '').intent).toMatchObject({ type: 'removeAttr' });
	});
});

describe('gaps', () => {
	const links = resolveLinks({
		sites: fx.index.dependencies,
		result: fx.result,
		scenario: finishScenario(fx.result),
		current: true,
	});
	const link = linksOfTask(links, 'design.sketch', fx.index, fx.result.project).waitsFor[0];

	it('sets, changes the kind of, and clears a gap on the successor', () => {
		if (!link) throw new Error('no link');
		const e = gapEdit(link, 'gaplength', '3d');
		expect(e.intent).toMatchObject({
			type: 'setDependsGap',
			task: 'design.sketch',
			target: 'design.research',
		});
		expect(e.label.text).toBe('Gap before Sketch: 3d after Research');
		expect(after(e.intent)).toBe(before.replace('gaplength 2d', 'gaplength 3d'));
		expect(after(gapEdit(link, 'gapduration', '2d').intent)).toBe(
			before.replace('gaplength 2d', 'gapduration 2d'),
		);
		const clear = gapEdit(link, 'gaplength', '');
		expect(clear.label.text).toBe('No gap before Sketch after Research');
		expect(after(clear.intent)).not.toContain('depends !research {');
	});
});

describe('project', () => {
	it('builds the header and attribute intents', () => {
		expect(projectEdit('name', ' New ')?.intent).toEqual({ type: 'setProjectHeader', name: 'New' });
		expect(projectEdit('end', '+17w')?.intent).toEqual({ type: 'setProjectHeader', end: '+17w' });
		expect(projectEdit('now', '2026-03-10-09:00')?.intent).toMatchObject({
			type: 'setProjectAttr',
			attr: 'now',
		});
		expect(projectEdit('now', '')?.intent).toMatchObject({ type: 'removeProjectAttr' });
		expect(projectEdit('timezone', 'Europe/Berlin')?.intent).toMatchObject({
			attr: 'timezone',
			value: '"Europe/Berlin"',
		});
		const name = projectEdit('name', 'Renamed plan');
		expect(after(name?.intent as EditIntent)).toBe(
			before.replace('"Gantt manipulation"', '"Renamed plan"'),
		);
	});
});
