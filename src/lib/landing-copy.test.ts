// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { landing, landingLinks } from './landing-copy';
import { demoPlan, demoPlanText, mockActiveLine, mockPlanText, samplePlan } from './landing-sample';

/** Every string in the copy, for the wording checks. */
function allText(value: unknown, out: string[] = []): string[] {
	if (typeof value === 'string') out.push(value);
	else if (Array.isArray(value)) value.forEach((v) => allText(v, out));
	else if (value && typeof value === 'object') Object.values(value).forEach((v) => allText(v, out));
	return out;
}

describe('landing copy: honesty', () => {
	it('lists the planned features from the build plan, and only those, as coming', () => {
		expect(landing.coming.map((c) => c.title)).toEqual([
			'Visual editing',
			'Workload and resources',
			'Plan health checks',
			'Save and sync',
			'Install and work offline',
			'Scenarios and tracking',
		]);
	});

	it('does not offer a planned feature as available', () => {
		const available = allText(landing.available).join(' ').toLowerCase();
		for (const planned of ['drag', 'heatmap', 'health check', 'offline', 'baseline']) {
			expect(available, planned).not.toContain(planned);
		}
	});

	it('keeps the hero facts to what works today', () => {
		const facts = landing.hero.facts.join(' ').toLowerCase();
		expect(facts).not.toContain('offline');
		expect(facts).not.toContain('install');
	});

	it('uses no hype words and no invented numbers of users or speed', () => {
		const text = allText(landing).join(' ').toLowerCase();
		for (const word of [
			'seamless',
			'powerful',
			'revolution',
			'blazing',
			'effortless',
			'game-chang',
			'cutting-edge',
			'best-in-class',
			'supercharge',
			'testimonial',
		]) {
			expect(text, word).not.toContain(word);
		}
		expect(text).not.toMatch(/\d+\s?(x|×)\s+faster/);
		expect(text).not.toMatch(/\d[\d,]*\+?\s+(users|teams|downloads|stars)/);
	});

	it('links only to https addresses', () => {
		for (const url of Object.values(landingLinks)) expect(url).toMatch(/^https:\/\//);
		expect(landingLinks.source).toBe('https://github.com/jackhale98/mainspring');
	});

	it('names the licence and credits TaskJuggler', () => {
		expect(landing.builtOn.gpl).toContain('GPL-2.0-or-later');
		expect(landing.builtOn.gpl).toContain('TaskJuggler');
		expect(landing.footer.legal).toContain(
			'GNU GPL, version 2 or (at your option) any later version',
		);
		expect(landing.builtOn.creditLink).toBe('taskjuggler.org');
	});
});

describe('landing copy: the illustrated plan', () => {
	it('has dependencies that name earlier tasks in the plan', () => {
		for (const plan of [samplePlan, demoPlan]) {
			const ids = new Set(plan.map((t) => t.id));
			for (const t of plan) {
				for (const dep of t.after) {
					expect(ids.has(dep), `${t.id} after ${dep}`).toBe(true);
					const pred = plan.find((p) => p.id === dep);
					expect(pred && pred.end <= t.start, `${dep} ends before ${t.id} starts`).toBe(true);
				}
			}
		}
	});

	it('starts every task on a working day', () => {
		for (const t of samplePlan) {
			expect(t.start % 7, `${t.id} start`).toBeLessThan(5);
		}
	});

	it('shows the line the highlight points at', () => {
		expect(mockPlanText[mockActiveLine]).toContain('effort 10d');
		expect(demoPlanText.some((line) => line.includes('effort 10d'))).toBe(true);
	});
});
