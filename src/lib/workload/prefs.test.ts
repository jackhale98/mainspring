// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { PrefStorage } from '../state/storage';
import {
	DEFAULT_SEGMENT,
	DEFAULT_VIEW,
	SEGMENTS,
	VIEWS,
	parseSegment,
	parseView,
	readSegment,
	readView,
	segmentKey,
	viewKey,
	writeSegment,
	writeView,
} from './prefs';

function memory(): PrefStorage & { map: Map<string, string> } {
	const map = new Map<string, string>();
	return {
		map,
		getItem: (k) => map.get(k) ?? null,
		setItem: (k, v) => void map.set(k, v),
	};
}

const blocked: PrefStorage = {
	getItem() {
		throw new Error('blocked');
	},
	setItem() {
		throw new Error('blocked');
	},
};

describe('people preferences', () => {
	it('names the four views and the four phone segments, Gantt and Load first', () => {
		expect(VIEWS).toEqual(['gantt', 'workload', 'resources', 'calendar']);
		expect(SEGMENTS).toEqual(['load', 'lanes', 'calendar', 'team']);
		expect(DEFAULT_VIEW).toBe('gantt');
		expect(DEFAULT_SEGMENT).toBe('load');
	});

	it('parses only the names', () => {
		for (const v of VIEWS) expect(parseView(v)).toBe(v);
		for (const s of SEGMENTS) expect(parseSegment(s)).toBe(s);
		for (const bad of [null, '', 'Gantt', 'lanes', 'team', ' workload', '{}']) {
			expect(parseView(bad)).toBeNull();
		}
		for (const bad of [null, '', 'Load', 'workload', 'resources', 'gantt']) {
			expect(parseSegment(bad)).toBeNull();
		}
	});

	it('keeps the view and the segment apart, per plan', () => {
		expect(viewKey('a')).not.toBe(viewKey('b'));
		expect(viewKey('a')).not.toBe(segmentKey('a'));
		const s = memory();
		writeView(s, 'a', 'resources');
		writeSegment(s, 'a', 'team');
		writeView(s, 'b', 'calendar');
		expect(readView(s, 'a')).toBe('resources');
		expect(readSegment(s, 'a')).toBe('team');
		expect(readView(s, 'b')).toBe('calendar');
		expect(readSegment(s, 'b')).toBeNull();
		expect(readView(s, 'c')).toBeNull();
	});

	it('ignores a stored value that is not a name', () => {
		const s = memory();
		s.map.set(viewKey('a'), 'timeline');
		s.map.set(segmentKey('a'), 'gantt');
		expect(readView(s, 'a')).toBeNull();
		expect(readSegment(s, 'a')).toBeNull();
	});

	it('survives missing and blocked storage', () => {
		expect(readView(null, 'a')).toBeNull();
		expect(readSegment(null, 'a')).toBeNull();
		expect(() => writeView(null, 'a', 'workload')).not.toThrow();
		expect(readView(blocked, 'a')).toBeNull();
		expect(() => writeView(blocked, 'a', 'workload')).not.toThrow();
		expect(() => writeSegment(blocked, 'a', 'team')).not.toThrow();
	});
});
