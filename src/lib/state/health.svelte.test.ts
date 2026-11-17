// SPDX-License-Identifier: GPL-2.0-or-later
// Plan health's state (health.svelte.ts, phase-3.md 9.1, 10): nothing is computed in the call that
// offers a result (the report is made in an idle task, from a chunk fetched then); the count is the
// report's; settings are stored per plan and make a new report at once; "N new problems" is said
// once per result and not for the first report or a settings change; a chunk that cannot be
// fetched says so and retries; a stale result never replaces a newer one.
import { describe, expect, it, vi } from 'vitest';
import type { ScheduleResult } from '../../engine/protocol';
import { goldenContext } from '../schedule/explain-testing';
import * as compute from '../health/compute';
import { defaultHealthSettings, withLinkMilestones } from '../health/settings';
import type { Finding, HealthReport } from '../health/types';
import { HealthState } from './health.svelte';
import type { PrefStorage } from './storage';

const memory = (): PrefStorage & { map: Map<string, string> } => {
	const map = new Map<string, string>();
	return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
};

/** An idle scheduler the test runs by hand. */
function manual() {
	const queue: Array<() => void> = [];
	return {
		schedule: (task: () => void) => {
			queue.push(task);
			return () => {
				const i = queue.indexOf(task);
				if (i >= 0) queue.splice(i, 1);
			};
		},
		run: () => queue.splice(0).forEach((t) => t()),
		get pending() {
			return queue.length;
		},
	};
}
const settle = () => new Promise((r) => setTimeout(r, 0));

const fedora = (() => {
	let ctx: ReturnType<typeof goldenContext> | null = null;
	return () => (ctx ??= goldenContext('fedora-res'));
})();

describe('HealthState with the real checks', () => {
	it('makes the report in an idle task, from a chunk fetched then', async () => {
		const idle = manual();
		const load = vi.fn(async () => compute);
		const s = new HealthState({ storage: memory(), load, schedule: idle.schedule });
		s.use('fedora-res');
		const { result, index } = fedora();
		s.offer(result, index);
		expect(s.count).toBeNull();
		expect(load).not.toHaveBeenCalled();
		idle.run();
		await settle();
		expect(load).toHaveBeenCalledTimes(1);
		expect(s.count).toBe(241);
		expect(s.status).toBe('ready');
		expect(s.report?.counts['no-predecessor']).toBe(26);
		expect(s.basis?.result).toBe(result);
	});

	it('offering the same result and index again changes nothing', async () => {
		const idle = manual();
		const s = new HealthState({
			storage: memory(),
			load: async () => compute,
			schedule: idle.schedule,
		});
		s.use('p');
		const { result, index } = fedora();
		s.offer(result, index);
		s.offer(result, index);
		expect(idle.pending).toBe(1);
	});

	it('settings are stored per plan (only what differs), and make a new report at once', async () => {
		const storage = memory();
		const idle = manual();
		const s = new HealthState({ storage, load: async () => compute, schedule: idle.schedule });
		s.use('fedora-res');
		const { result, index } = fedora();
		s.offer(result, index);
		idle.run();
		await settle();
		const before = s.report?.counts;
		s.setSettings(withLinkMilestones(s.settings ?? defaultHealthSettings(), true));
		await settle();
		expect(storage.map.get('mainspring.health.fedora-res')).toBe('{"linkMilestones":true}');
		expect(s.report?.counts['no-predecessor']).toBeGreaterThan(before?.['no-predecessor'] ?? 0);
		expect(s.report?.counts['no-successor']).toBeGreaterThan(before?.['no-successor'] ?? 0);
		// Another plan has its own; coming back reads this one again.
		s.use('other');
		expect(s.settings).toBeNull();
		expect(s.report).toBeNull();
		s.offer(result, index);
		idle.run();
		await settle();
		expect(s.settings?.linkMilestones).toBe(false);
		s.use('fedora-res');
		s.offer(result, index);
		idle.run();
		await settle();
		expect(s.settings?.linkMilestones).toBe(true);
	});

	it('a check turned off has no findings and no count', async () => {
		const idle = manual();
		const s = new HealthState({
			storage: memory(),
			load: async () => compute,
			schedule: idle.schedule,
		});
		s.use('p');
		const { result, index } = fedora();
		s.offer(result, index);
		idle.run();
		await settle();
		const now = s.settings ?? defaultHealthSettings();
		s.setSettings({
			...now,
			enabled: { ...now.enabled, 'no-predecessor': false, 'no-successor': false },
		});
		await settle();
		expect(s.report?.counts['no-predecessor']).toBe(0);
		expect(s.count).toBe(241 - 26 - 61);
	});
});

describe('HealthState with scripted reports', () => {
	const finding = (id: string): Finding => ({
		check: 'no-predecessor',
		severity: 'warning',
		subject: { kind: 'task', id },
		at: null,
		fixes: [],
		facts: null,
	});
	const rep = (revision: number, ...ids: string[]): HealthReport => ({
		revision,
		findings: ids.map(finding),
		counts: { 'no-predecessor': ids.length } as HealthReport['counts'],
	});
	const fake = (reports: HealthReport[]) => ({
		computeHealth: vi.fn(() => reports.shift() ?? null),
		newFindings: compute.newFindings,
		readHealthSettings: compute.readHealthSettings,
		writeHealthSettings: compute.writeHealthSettings,
	});
	const resultOf = (revision: number): ScheduleResult => ({ ...fedora().result, revision });

	it('says how many problems are new, once per result; not for the first report', async () => {
		const idle = manual();
		const mod = fake([rep(1, 'a'), rep(2, 'a', 'b', 'c'), rep(3, 'a', 'b', 'c')]);
		const s = new HealthState({
			storage: memory(),
			load: async () => mod,
			schedule: idle.schedule,
		});
		s.use('p');
		const { index } = fedora();
		s.offer(resultOf(1), index);
		idle.run();
		await settle();
		expect(s.announcement).toBe('');
		s.offer(resultOf(2), index);
		idle.run();
		await settle();
		expect(s.announcement.replace('​', '')).toBe('2 new problems');
		// A result with nothing new says nothing more (the last words stay for the live region).
		const said = s.announcement;
		s.offer(resultOf(3), index);
		idle.run();
		await settle();
		expect(s.announcement).toBe(said);
	});

	it('one new problem is singular, and the same words twice still change the text', async () => {
		const idle = manual();
		const mod = fake([rep(1, 'a'), rep(2, 'a', 'b'), rep(3, 'a', 'b', 'c')]);
		const s = new HealthState({
			storage: memory(),
			load: async () => mod,
			schedule: idle.schedule,
		});
		s.use('p');
		const { index } = fedora();
		const said: string[] = [];
		for (const n of [1, 2, 3]) {
			s.offer(resultOf(n), index);
			idle.run();
			await settle();
			said.push(s.announcement);
		}
		expect(said[1]?.replace('​', '')).toBe('1 new problem');
		expect(said[2]?.replace('​', '')).toBe('1 new problem');
		expect(said[2]).not.toBe(said[1]);
	});

	it('a settings change does not announce', async () => {
		const idle = manual();
		const mod = fake([rep(1, 'a'), rep(1, 'a', 'b')]);
		const s = new HealthState({
			storage: memory(),
			load: async () => mod,
			schedule: idle.schedule,
		});
		s.use('p');
		s.offer(resultOf(1), fedora().index);
		idle.run();
		await settle();
		s.setSettings({ ...(s.settings ?? defaultHealthSettings()), longGapDays: 9 });
		await settle();
		expect(s.count).toBe(2);
		expect(s.announcement).toBe('');
	});

	it('a chunk that cannot be fetched says so and retries', async () => {
		const idle = manual();
		let ok = false;
		const load = vi.fn(async () => {
			if (!ok) throw new Error('offline');
			return fake([rep(1, 'a')]);
		});
		const s = new HealthState({ storage: memory(), load, schedule: idle.schedule });
		s.use('p');
		s.offer(resultOf(1), fedora().index);
		idle.run();
		await settle();
		expect(s.status).toBe('failed');
		expect(s.count).toBeNull();
		ok = true;
		s.retry();
		await settle();
		expect(s.status).toBe('ready');
		expect(s.count).toBe(1);
		expect(load).toHaveBeenCalledTimes(2);
	});

	it('a newer result is not replaced by the report of an older one', async () => {
		const idle = manual();
		let release: (() => void) | null = null;
		const gate = new Promise<void>((r) => (release = r));
		const mod = fake([rep(2, 'a', 'b')]);
		const s = new HealthState({
			storage: memory(),
			load: async () => {
				await gate;
				return mod;
			},
			schedule: idle.schedule,
		});
		s.use('p');
		const { index } = fedora();
		s.offer(resultOf(1), index);
		idle.run();
		s.offer(resultOf(2), index);
		(release as (() => void) | null)?.();
		idle.run();
		await settle();
		// Only the newer result's report was made.
		expect(mod.computeHealth).toHaveBeenCalledTimes(1);
		expect(s.report?.revision).toBe(2);
	});

	it('a result and index of null clear the report; show, hide and toggle count requests', async () => {
		const idle = manual();
		const s = new HealthState({
			storage: memory(),
			load: async () => fake([rep(1, 'a')]),
			schedule: idle.schedule,
		});
		s.use('p');
		s.offer(resultOf(1), fedora().index);
		idle.run();
		await settle();
		expect(s.count).toBe(1);
		s.offer(null, null);
		expect(s.count).toBeNull();
		expect(s.open).toBe(false);
		s.show();
		s.show();
		expect([s.open, s.serial]).toEqual([true, 2]);
		s.settingsOpen = true;
		s.toggle();
		expect([s.open, s.settingsOpen]).toEqual([false, false]);
	});
});
