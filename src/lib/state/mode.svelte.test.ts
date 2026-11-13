// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { ModeState, modeKey, splitKey, tableKey } from './mode.svelte';
import { DEFAULT_RATIOS } from './split';
import type { PrefStorage } from './storage';

function memory(): PrefStorage & { data: Map<string, string> } {
	const data = new Map<string, string>();
	return {
		data,
		getItem: (k) => data.get(k) ?? null,
		setItem: (k, v) => void data.set(k, v),
	};
}

describe('ModeState', () => {
	it('remembers the mode per sample', () => {
		const storage = memory();
		const a = new ModeState({ storage });
		a.use('plan-a');
		expect(a.choice).toBeNull();
		a.set('text');
		a.use('plan-b');
		expect(a.choice).toBeNull();
		a.set('visual');
		expect(storage.data.get(modeKey('plan-a'))).toBe('text');
		expect(storage.data.get(modeKey('plan-b'))).toBe('visual');
		a.use('plan-a');
		expect(a.choice).toBe('text');

		// A new session reads the same.
		const b = new ModeState({ storage });
		b.use('plan-b');
		expect(b.choice).toBe('visual');
	});

	it('lets a link win once, for the first sample only', () => {
		const storage = memory();
		storage.setItem(modeKey('plan-a'), 'split');
		const s = new ModeState({ storage, linked: 'text' });
		s.use('plan-a');
		expect(s.choice).toBe('text');
		s.use('plan-b');
		expect(s.choice).toBeNull();
		s.use('plan-a');
		expect(s.choice).toBe('split');
	});

	it('ignores a stored mode it does not know', () => {
		const storage = memory();
		storage.setItem(modeKey('x'), 'kanban');
		const s = new ModeState({ storage });
		s.use('x');
		expect(s.choice).toBeNull();
	});

	it('keeps and saves the divider per sample', () => {
		const storage = memory();
		const s = new ModeState({ storage });
		s.use('x');
		expect(s.ratios).toEqual(DEFAULT_RATIOS);
		s.setRatio('col', 0.55);
		s.setRatio('row', 5);
		expect(s.ratios.col).toBe(0.55);
		expect(s.ratios.row).toBe(0.8);
		expect(storage.data.has(splitKey('x'))).toBe(false);
		s.saveRatios();
		const again = new ModeState({ storage });
		again.use('x');
		expect(again.ratios).toEqual({ col: 0.55, row: 0.8 });
		again.use('y');
		expect(again.ratios).toEqual(DEFAULT_RATIOS);
	});

	it("keeps and saves the Gantt's table divider per sample, none meaning the default", () => {
		const storage = memory();
		const s = new ModeState({ storage });
		s.use('x');
		expect(s.table).toBeNull();
		s.saveTable();
		expect(storage.data.has(tableKey('x'))).toBe(false);
		s.setTable(0.45);
		s.setTable(9);
		expect(s.table).toBe(0.8);
		expect(storage.data.has(tableKey('x'))).toBe(false);
		s.setTable(0.45);
		s.saveTable();
		const again = new ModeState({ storage });
		again.use('x');
		expect(again.table).toBe(0.45);
		again.use('y');
		expect(again.table).toBeNull();
		storage.data.set(tableKey('z'), 'junk');
		again.use('z');
		expect(again.table).toBeNull();
	});

	it('works with no storage at all', () => {
		const s = new ModeState({ storage: null });
		s.use('x');
		s.set('split');
		expect(s.choice).toBe('split');
		expect(() => s.saveRatios()).not.toThrow();
	});
});
