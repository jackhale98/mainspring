// SPDX-License-Identifier: GPL-2.0-or-later
// What each kind of fix does (run-fix.ts, phase-3.md section 12): an intent is one dispatch with the
// fix's own label, "Edit gap" sends the typed gap (an empty one removes it), a pick opens the
// dependency picker after the panel left and says so when it is refused, a disabled fix never
// runs, "Replace…" sends the Gantt action, and the places (open, why, show) close the panel where
// it would cover them.
import { describe, expect, it, vi } from 'vitest';
import type { DispatchOutcome } from '../state/edits.svelte';
import { needsInput, replaceWith, runFix, withGap, type FixEnv } from './run-fix';
import type { Finding, Fix } from './types';

const applied = { status: 'applied' } as unknown as DispatchOutcome;
const refused = { status: 'refused' } as unknown as DispatchOutcome;

function env(over: Partial<FixEnv> = {}): FixEnv & { log: string[] } {
	const log: string[] = [];
	const e: FixEnv = {
		openDependencyPicker: vi.fn((t, r) => {
			log.push(`pick ${t} ${r}`);
			return true;
		}),
		openInWorkload: vi.fn((r, at) => void log.push(`workload ${r} ${at}`)),
		openInCalendar: vi.fn((r) => void log.push(`calendar ${r}`)),
		showWhy: vi.fn((t) => void log.push(`why ${t}`)),
		showInText: vi.fn((at) => void log.push(`text ${at.file}:${at.from}`)),
		edit: vi.fn(async (x) => {
			log.push(`edit ${JSON.stringify(x.intent)} ${x.label.text}`);
			return applied;
		}),
		action: vi.fn(async (a) => {
			log.push(`action ${JSON.stringify(a)}`);
			return applied;
		}),
		say: vi.fn((m) => void log.push(`say ${m}`)),
		leave: vi.fn(async (to) => void log.push(`leave ${to}`)),
		...over,
	};
	return Object.assign(e, { log });
}

const finding = (at: Finding['at'] = null): Finding =>
	({
		check: 'no-predecessor',
		severity: 'warning',
		subject: { kind: 'task', id: 'a' },
		at,
		fixes: [],
		facts: null,
	}) as Finding;

const remove: Fix = {
	kind: 'intent',
	label: 'Remove start (5 Jan 2026)',
	intent: { type: 'removeAttr', task: 'a', attr: 'start' },
	disabled: null,
};
const gapFix: Fix = {
	kind: 'intent',
	label: 'Edit gap',
	intent: {
		type: 'setDependsGap',
		task: 'b',
		target: 'a',
		gap: { kind: 'gaplength', value: '25d' },
	},
	disabled: null,
};

describe('runFix', () => {
	it('an intent is one dispatch, labelled with the fix', async () => {
		const e = env();
		expect(await runFix(remove, finding(), e)).toBe('applied');
		expect(e.log).toEqual([
			'edit {"type":"removeAttr","task":"a","attr":"start"} Remove start (5 Jan 2026)',
		]);
	});

	it('a refusal comes back as refused (the dispatcher already said why)', async () => {
		const e = env({ edit: vi.fn(async () => refused) });
		expect(await runFix(remove, finding(), e)).toBe('refused');
	});

	it('a disabled fix never runs', async () => {
		const e = env();
		const off: Fix = { ...remove, disabled: 'macro-call' };
		expect(await runFix(off, finding(), e)).toBe('unavailable');
		expect(e.log).toEqual([]);
	});

	it('a pick leaves for the details, then opens the picker; a refused picker is said', async () => {
		const e = env();
		const pick: Fix = { kind: 'pick', role: 'predecessor', task: 'a', disabled: null };
		expect(await runFix(pick, finding(), e)).toBe('opened');
		expect(e.log).toEqual(['leave details', 'pick a predecessor']);
		const no = env({ openDependencyPicker: vi.fn(() => false) });
		expect(await runFix(pick, finding(), no)).toBe('unavailable');
		expect(no.log).toEqual(['leave details', 'say This task can only be changed in the text.']);
	});

	it('open, why and show close the panel where it would cover them', async () => {
		const e = env();
		await runFix(
			{ kind: 'open', view: 'workload', resource: 'dev1', at: 120, disabled: null },
			finding(),
			e,
		);
		await runFix(
			{ kind: 'open', view: 'calendar', resource: 'dev1', at: 120, disabled: null },
			finding(),
			e,
		);
		await runFix({ kind: 'why', task: 'a', disabled: null }, finding(), e);
		await runFix({ kind: 'show', disabled: null }, finding({ file: 'p.tjp', from: 4, to: 9 }), e);
		expect(e.log).toEqual([
			'leave view',
			'workload dev1 120',
			'leave view',
			'calendar dev1',
			'leave details',
			'why a',
			'leave text',
			'text p.tjp:4',
		]);
	});

	it('show with no place in the text does nothing', async () => {
		const e = env();
		expect(await runFix({ kind: 'show', disabled: null }, finding(null), e)).toBe('unavailable');
		expect(e.log).toEqual([]);
	});
});

describe('the fixes that need a value', () => {
	it('says which', () => {
		expect(needsInput(gapFix)).toBe('gap');
		expect(needsInput({ kind: 'replace-person', task: 'a', from: 'dev1', disabled: null })).toBe(
			'person',
		);
		expect(needsInput(remove)).toBeNull();
	});

	it('"Edit gap" sends the typed gap in the kind the link has, and an empty gap removes it', async () => {
		const e = env();
		if (gapFix.kind !== 'intent') throw new Error('not an intent');
		await withGap(gapFix, ' 5d ', e);
		await withGap(gapFix, '  ', e);
		expect(e.log).toEqual([
			'edit {"type":"setDependsGap","task":"b","target":"a","gap":{"kind":"gaplength","value":"5d"}} Edit gap',
			'edit {"type":"setDependsGap","task":"b","target":"a","gap":null} Edit gap',
		]);
	});

	it('"Replace…" sends the Gantt action to the chosen person', async () => {
		const e = env();
		const fix = { kind: 'replace-person', task: 'a', from: 'dev1', disabled: null } as const;
		expect(await replaceWith(fix, 'dev2', e)).toBe('applied');
		expect(e.log).toEqual([
			'action {"type":"replace-person","task":"a","from":"dev1","to":"dev2"}',
		]);
		expect(await replaceWith({ ...fix, disabled: 'macro-call' }, 'dev2', env())).toBe(
			'unavailable',
		);
	});
});
