// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { PrefStorage } from '../state/storage';
import {
	MAX_PX_PER_DAY,
	MOVE_KEY,
	readCollapsed,
	readMovePreference,
	readZoom,
	takeConstraintWarning,
	writeCollapsed,
	writeMovePreference,
	writeZoom,
	zoomKey,
} from './prefs';

function memory(): PrefStorage & { data: Map<string, string> } {
	const data = new Map<string, string>();
	return {
		data,
		getItem: (k) => data.get(k) ?? null,
		setItem: (k, v) => void data.set(k, v),
	};
}

const blocked: PrefStorage = {
	getItem: () => {
		throw new Error('blocked');
	},
	setItem: () => {
		throw new Error('blocked');
	},
};

describe('Gantt preferences', () => {
	it('remembers the move preference once per browser, ignoring junk', () => {
		const s = memory();
		expect(readMovePreference(s)).toBeNull();
		writeMovePreference(s, { kind: 'gap' });
		expect(readMovePreference(s)).toEqual({ kind: 'gap' });
		s.data.set(MOVE_KEY, 'sideways');
		expect(readMovePreference(s)).toBeNull();
	});

	it('shows the constraint warning once', () => {
		const s = memory();
		expect(takeConstraintWarning(s)).toBe(true);
		expect(takeConstraintWarning(s)).toBe(false);
	});

	it('keeps zoom per sample, clamped, and rejects junk', () => {
		const s = memory();
		writeZoom(s, 'a', 24);
		writeZoom(s, 'b', 1e9);
		expect(readZoom(s, 'a')).toBe(24);
		expect(readZoom(s, 'b')).toBe(MAX_PX_PER_DAY);
		expect(readZoom(s, 'c')).toBeNull();
		s.data.set(zoomKey('a'), 'wide');
		expect(readZoom(s, 'a')).toBeNull();
	});

	it('keeps collapsed rows per sample and survives bad JSON', () => {
		const s = memory();
		writeCollapsed(s, 'a', new Set(['task:design', 'task:build']));
		expect(readCollapsed(s, 'a')).toEqual(new Set(['task:design', 'task:build']));
		expect(readCollapsed(s, 'b')).toEqual(new Set());
		s.data.set('mainspring.gantt.collapsed.a', '{oops');
		expect(readCollapsed(s, 'a')).toEqual(new Set());
		s.data.set('mainspring.gantt.collapsed.a', '[1, "task:x"]');
		expect(readCollapsed(s, 'a')).toEqual(new Set(['task:x']));
	});

	it('works without storage, or with blocked storage, from the defaults', () => {
		for (const s of [null, blocked]) {
			writeMovePreference(s, { kind: 'start' });
			writeZoom(s, 'a', 10);
			writeCollapsed(s, 'a', new Set(['x']));
			expect(readMovePreference(s)).toBeNull();
			expect(readZoom(s, 'a')).toBeNull();
			expect(readCollapsed(s, 'a')).toEqual(new Set());
			// Without storage the warning cannot be remembered; it is shown each time.
			expect(takeConstraintWarning(s)).toBe(true);
		}
	});
});
