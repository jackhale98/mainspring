// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { landing, landingLinks } from './landing-copy';
import {
	demoPlan,
	heroPlan,
	mockActiveLine,
	mockPlanText,
	mockSelectedLines,
	planDiff,
	samplePlan,
} from './landing-sample';

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

	it('says plainly that visual editing is not built yet', () => {
		// The hero line the user asked for, word for word.
		expect(landing.hero.note).toBe(
			'Early preview: today you edit the text and see the Gantt. Drag-and-drop editing is coming next.',
		);
		expect(landing.hero.facts).toEqual([
			'No syntax to learn',
			'Your files, your repo',
			'Real resource leveling',
			'Open source',
		]);
		// Anything about dragging or writing the file for you is tagged as coming.
		for (const p of landing.syntax.points) {
			const visual = /resize|draw a|drop a|only the lines you touched/i.test(p.title + p.body);
			expect(p.coming, p.title).toBe(visual);
		}
		expect(landing.syntax.next).toBe('Visual editing is the next step.');
		expect(landing.syntax.nextBody).toContain('Today you edit the text');
		expect(landing.faq.items[0]?.a).toContain('Visual editing is coming');
		expect(landing.coming[0]?.title).toBe('Visual editing');
	});

	it('marks the schedule diff in the pull-request mock as coming', () => {
		expect(landing.repo.pr.effectTag).toBe('Schedule diff');
		expect(landing.repo.pr.caption).toContain('schedule diff is coming');
		expect(landing.repo.note).toContain('does not commit for you yet');
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
		expect(mockPlanText[mockActiveLine]).toContain('effort 5d');
	});

	it('pairs the hero text with the hero bars: one text block per task, Design selected', () => {
		for (const t of heroPlan) {
			expect(
				mockPlanText.some((line) => line === `task ${t.id} "${t.name}" {`),
				t.id,
			).toBe(true);
		}
		expect(heroPlan).toHaveLength(4);
		const [from, to] = mockSelectedLines;
		expect(mockPlanText[from]).toBe('task design "Design" {');
		expect(mockPlanText[to]).toBe('}');
		expect(mockActiveLine).toBeGreaterThan(from);
		expect(mockActiveLine).toBeLessThan(to);
		const text = mockPlanText.join('\n');
		for (const keyword of ['task', 'depends', 'effort', 'allocate']) {
			expect(text).toContain(keyword);
		}
		// The dependencies in the text are the links in the chart.
		expect(text).toContain('depends !design');
		expect(heroPlan.find((t) => t.id === 'build')?.after).toEqual(['design']);
		expect(heroPlan.find((t) => t.id === 'test')?.after).toEqual(['build']);
	});

	it('tells one story: the diff changes the effort that the finish note describes', () => {
		const del = planDiff.find((l) => l.kind === 'del');
		const add = planDiff.find((l) => l.kind === 'add');
		expect(del?.text.trim()).toBe('effort 5d');
		expect(add?.text.trim()).toBe('effort 8d');
		expect(landing.repo.pr.effect).toBe('Finish moves Jan 6 → Jan 9');
		// The plan on the Gantt is the 5d plan: Test ends on day 16 (Jan 6) and the milestone sits there.
		const launch = samplePlan.find((t) => t.id === 'launch');
		expect(launch?.start).toBe(16);
	});
});
