// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
	bodyContext,
	CONTEXTS,
	GLOBAL_CONTEXT,
	isContext,
	isScenarioSpecific,
	keywordById,
	KEYWORDS,
	keywordsInContext,
	PROLOG_CONTEXT,
	resolveKeyword,
	TJ_COMMIT,
	TJ_VERSION,
	topContextId,
	type KeywordEntry,
} from './keywords';

const pin = JSON.parse(
	readFileSync(new URL('../../../../engine/tj.pin.json', import.meta.url), 'utf8'),
) as {
	commit: string;
	version: string;
};

function must(e: KeywordEntry | null): KeywordEntry {
	if (!e) throw new Error('expected a keyword');
	return e;
}

describe('the committed table', () => {
	it('was generated from the pinned TaskJuggler', () => {
		expect(TJ_VERSION).toBe(pin.version);
		expect(TJ_COMMIT).toBe(pin.commit);
	});

	it('holds every keyword once, sorted by id, with the name as written', () => {
		expect(KEYWORDS.length).toBeGreaterThanOrEqual(250);
		const ids = KEYWORDS.map((k) => k.keyword);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).toEqual([...ids].sort());
		for (const k of KEYWORDS) {
			// The id without its scope, except where TaskJuggler's parser expects another word: the
			// first word of the syntax line ('leaveallowance' is written 'leaveallowances').
			const first = /^[a-z][a-z0-9]*/.exec(k.syntax)?.[0];
			const written = k.contexts.length > 0 && first ? first : k.keyword.split('.')[0];
			expect(k.name, k.keyword).toBe(written);
			expect(k.name).toMatch(/^[a-z][a-z0-9]*$/);
			expect(k.syntax.length).toBeGreaterThan(0);
			expect(k.summary.length).toBeGreaterThan(0);
			expect(k.contexts).toEqual([...new Set(k.contexts)].sort());
		}
	});

	it('differs from the id only for leaveallowances', () => {
		const renamed = KEYWORDS.filter((k) => k.name !== k.keyword.split('.')[0]);
		expect(renamed.map((k) => `${k.keyword}:${k.name}`)).toEqual([
			'leaveallowance:leaveallowances',
		]);
	});

	it('names only contexts that are keywords, the top level or the prolog', () => {
		for (const c of CONTEXTS) {
			if (c !== GLOBAL_CONTEXT && c !== PROLOG_CONTEXT) expect(keywordById(c)).not.toBeNull();
		}
		expect(CONTEXTS).toContain(GLOBAL_CONTEXT);
		expect(CONTEXTS).toContain(PROLOG_CONTEXT);
	});

	it('never maps one name to two keywords in a context', () => {
		for (const c of CONTEXTS) {
			const names = keywordsInContext(c).map((k) => k.name);
			expect(new Set(names).size).toBe(names.length);
		}
	});
});

describe('resolveKeyword', () => {
	it('resolves MVP task and resource attributes', () => {
		for (const name of ['effort', 'length', 'duration', 'start', 'end', 'depends', 'allocate']) {
			expect(resolveKeyword(name, 'task')?.keyword).toBe(name);
		}
		expect(resolveKeyword('note', 'task')?.keyword).toBe('note.task');
		expect(resolveKeyword('flags', 'task')?.keyword).toBe('flags.task');
		expect(resolveKeyword('efficiency', 'resource')?.keyword).toBe('efficiency');
		expect(resolveKeyword('rate', 'resource')?.keyword).toBe('rate.resource');
		expect(resolveKeyword('workinghours', 'project')?.keyword).toBe('workinghours.project');
		expect(resolveKeyword('workinghours', 'resource')?.keyword).toBe('workinghours.resource');
	});

	it('picks the scoped keyword for the context', () => {
		expect(resolveKeyword('booking', 'task')?.keyword).toBe('booking.task');
		expect(resolveKeyword('booking', 'resource')?.keyword).toBe('booking.resource');
		expect(resolveKeyword('task', GLOBAL_CONTEXT)?.keyword).toBe('task');
		expect(resolveKeyword('task', 'timesheet')?.keyword).toBe('task.timesheet');
		expect(resolveKeyword('dailymax', 'limits.task')?.keyword).toBe('dailymax');
		expect(resolveKeyword('gapduration', 'depends')?.keyword).toBe('gapduration');
	});

	it('resolves include by where it stands', () => {
		expect(resolveKeyword('include', GLOBAL_CONTEXT)?.keyword).toBe('include.properties');
		expect(resolveKeyword('include', 'project')?.keyword).toBe('include.project');
		expect(resolveKeyword('include', PROLOG_CONTEXT)?.keyword).toBe('include.macro');
	});

	it('knows the top level and the prolog', () => {
		expect(resolveKeyword('project', GLOBAL_CONTEXT)?.keyword).toBe('project');
		expect(resolveKeyword('macro', GLOBAL_CONTEXT)?.keyword).toBe('macro');
		expect(resolveKeyword('macro', PROLOG_CONTEXT)?.keyword).toBe('macro');
		expect(keywordsInContext(PROLOG_CONTEXT).map((k) => k.keyword)).toEqual([
			'include.macro',
			'macro',
		]);
	});

	it('returns null outside the keyword context, for unknown names and for other cases', () => {
		expect(resolveKeyword('effort', GLOBAL_CONTEXT)).toBeNull();
		expect(resolveKeyword('effort', 'resource')).toBeNull();
		expect(resolveKeyword('start', 'depends')).toBeNull();
		expect(resolveKeyword('Effort', 'task')).toBeNull();
		expect(resolveKeyword('nonsense', 'task')).toBeNull();
		expect(resolveKeyword('effort', 'no-such-context')).toBeNull();
		expect(resolveKeyword('booking.task', 'task')).toBeNull();
	});

	it('finds every listed keyword by its name (property)', () => {
		const pairs = CONTEXTS.flatMap((c) => keywordsInContext(c).map((k) => [c, k] as const));
		fc.assert(
			fc.property(fc.constantFrom(...pairs), ([context, entry]) => {
				expect(resolveKeyword(entry.name, context)).toBe(entry);
				expect(entry.contexts).toContain(context);
			}),
		);
	});

	it('resolves only names that some keyword has (property)', () => {
		const names = new Set(KEYWORDS.map((k) => k.name));
		fc.assert(
			fc.property(fc.string(), fc.constantFrom(...CONTEXTS), (name, context) => {
				const hit = resolveKeyword(name, context);
				if (!names.has(name)) expect(hit).toBeNull();
				if (hit) expect(hit.name).toBe(name);
			}),
		);
	});
});

describe('keywordsInContext', () => {
	it('lists the context, sorted by name', () => {
		const task = keywordsInContext('task');
		const names = task.map((k) => k.name);
		expect(names).toEqual([...names].sort());
		expect(names).toContain('effort');
		expect(names).toContain('task');
		expect(names).not.toContain('project');
		expect(keywordsInContext('no-such-context')).toEqual([]);
	});

	it('narrows to scenario-specific keywords after a scenario prefix', () => {
		const only = keywordsInContext('task', { scenarioSpecificOnly: true });
		expect(only.length).toBeGreaterThan(0);
		expect(only.every((k) => k.scenarioSpecific)).toBe(true);
		expect(only.map((k) => k.name)).toContain('effort');
		expect(only.map((k) => k.name)).not.toContain('note');
	});
});

describe('isScenarioSpecific', () => {
	it('follows the table', () => {
		expect(isScenarioSpecific('effort', 'task')).toBe(true);
		expect(isScenarioSpecific('booking', 'resource')).toBe(true);
		expect(isScenarioSpecific('note', 'task')).toBe(false);
		expect(isScenarioSpecific('email', 'resource')).toBe(false);
		expect(isScenarioSpecific('effort', GLOBAL_CONTEXT)).toBe(false);
	});
});

describe('contexts of bodies', () => {
	it('knows which keywords open a context', () => {
		expect(isContext('task')).toBe(true);
		expect(isContext('limits.task')).toBe(true);
		expect(isContext('effort')).toBe(false);
		expect(isContext('supplement')).toBe(false);
	});

	it('gives the body context of a statement', () => {
		expect(bodyContext(must(resolveKeyword('task', GLOBAL_CONTEXT)))).toBe('task');
		expect(bodyContext(must(resolveKeyword('task', GLOBAL_CONTEXT)), 'timesheet')).toBe('task');
		expect(bodyContext(must(resolveKeyword('limits', 'resource')))).toBe('limits.resource');
		expect(bodyContext(must(resolveKeyword('depends', 'task')))).toBe('depends');
		expect(bodyContext(must(resolveKeyword('include', GLOBAL_CONTEXT)))).toBe('include.properties');
		expect(bodyContext(must(resolveKeyword('effort', 'task')))).toBeNull();
	});

	it('opens supplement bodies by their subject', () => {
		const supplement = must(resolveKeyword('supplement', GLOBAL_CONTEXT));
		expect(bodyContext(supplement, 'task')).toBe('supplement.task');
		expect(bodyContext(supplement, 'resource')).toBe('supplement.resource');
		expect(bodyContext(supplement, 'account')).toBeNull();
		expect(bodyContext(supplement)).toBeNull();
		expect(resolveKeyword('effort', 'supplement.task')?.keyword).toBe('effort');
	});

	it('maps top contexts', () => {
		expect(topContextId('global')).toBe(GLOBAL_CONTEXT);
		expect(topContextId('project')).toBe('project');
		expect(topContextId('prolog')).toBe(PROLOG_CONTEXT);
		expect(resolveKeyword('timezone', topContextId('project'))?.keyword).toBe('timezone');
	});
});
